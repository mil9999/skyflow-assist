import { AuditAction, FlightStatus } from "../../domain/constants";
import { DomainError, ErrorCode } from "../../domain/errors";
import { assertTransitionAllowed } from "../../domain/rebooking-state";
import { prisma } from "../db/prisma";
import * as bookingRepository from "../repositories/booking-repository";
import * as flightRepository from "../repositories/flight-repository";
import * as sessionRepository from "../repositories/session-repository";
import * as auditService from "./audit-service";

export interface GetDisruptedBookingInput {
  sessionId: string;
}

export interface DisruptedBookingResult {
  bookingReference: string;
  flight: {
    flightNumber: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    status: string;
  };
  disruption: {
    type: string;
    reason: string;
  };
}

export async function getDisruptedBooking(
  input: GetDisruptedBookingInput,
): Promise<DisruptedBookingResult> {
  const session = await sessionRepository.findById(prisma, input.sessionId);
  if (!session) {
    throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
  }
  if (session.state !== "VERIFIED") {
    throw new DomainError(
      ErrorCode.INVALID_STATE,
      "The passenger must be verified before booking details can be shared.",
    );
  }
  if (!session.bookingId) {
    throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "No booking attached to this session.");
  }

  const booking = await bookingRepository.findById(prisma, session.bookingId);
  if (!booking) {
    throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "Booking not found.");
  }
  if (booking.status === "REBOOKED") {
    throw new DomainError(ErrorCode.ALREADY_REBOOKED, "This booking has already been changed.");
  }

  const flight = booking.flight;
  const isDisrupted =
    flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.DELAYED;
  if (!isDisrupted) {
    throw new DomainError(
      ErrorCode.BOOKING_NOT_DISRUPTED,
      "This flight is running as scheduled.",
    );
  }

  const disruption = await flightRepository.findDisruption(prisma, flight.id);

  assertTransitionAllowed(session.state, "BOOKING_LOADED");
  await sessionRepository.transition(prisma, session.id, "BOOKING_LOADED");
  await auditService.record(prisma, session.id, AuditAction.BOOKING_RETRIEVED, {
    bookingReference: booking.bookingReference,
    flightNumber: flight.flightNumber,
  });

  return {
    bookingReference: booking.bookingReference,
    flight: {
      flightNumber: flight.flightNumber,
      origin: flight.origin,
      destination: flight.destination,
      departureTime: flight.departureTime.toISOString(),
      arrivalTime: flight.arrivalTime.toISOString(),
      status: flight.status,
    },
    disruption: {
      type: disruption?.type ?? (flight.status === FlightStatus.CANCELLED ? "CANCELLATION" : "DELAY"),
      reason: disruption?.reason ?? "Operational disruption",
    },
  };
}
