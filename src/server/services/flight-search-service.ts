import { AuditAction } from "../../domain/constants";
import { DomainError, ErrorCode } from "../../domain/errors";
import { assertTransitionAllowed } from "../../domain/rebooking-state";
import { findAlternatives, type Flight } from "../../domain/rebooking";
import { prisma } from "../db/prisma";
import * as bookingRepository from "../repositories/booking-repository";
import * as flightRepository from "../repositories/flight-repository";
import * as sessionRepository from "../repositories/session-repository";
import * as auditService from "./audit-service";

export interface SearchInput {
  sessionId: string;
  latestArrivalTime?: Date | string;
  directOnly?: boolean;
}

export interface FlightOption {
  optionId: string;
  flightId: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  connections: number;
  availableSeats: number;
  additionalCost: number;
}

export interface SearchResult {
  options: FlightOption[];
}

/**
 * A candidate must depart after the disrupted flight was due to leave *and*
 * after the present moment, whichever is later.
 */
export function searchFloor(originalDeparture: Date, now: Date = new Date()): Date {
  return new Date(Math.max(now.getTime(), originalDeparture.getTime()));
}

export async function searchAlternativeFlights(input: SearchInput): Promise<SearchResult> {
  const session = await sessionRepository.findById(prisma, input.sessionId);
  if (!session) {
    throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
  }
  // Repeat searches are allowed once options are on the table (the passenger may
  // narrow the criteria), but the booking must have been loaded first.
  if (session.state !== "BOOKING_LOADED" && session.state !== "OPTIONS_PRESENTED") {
    throw new DomainError(
      ErrorCode.INVALID_STATE,
      "The disrupted booking must be loaded before searching.",
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

  const original = booking.flight as Flight;
  const candidates = (await flightRepository.findRoute(
    prisma,
    original.origin,
    original.destination,
  )) as Flight[];

  const latestArrivalTime = input.latestArrivalTime
    ? new Date(input.latestArrivalTime)
    : undefined;

  const alternatives = findAlternatives(original, candidates, {
    now: searchFloor(original.departureTime),
    directOnly: input.directOnly,
    latestArrivalTime,
  });

  if (alternatives.length === 0) {
    await auditService.record(prisma, session.id, AuditAction.ALTERNATIVES_SEARCHED, {
      count: 0,
      directOnly: input.directOnly ?? false,
    });
    throw new DomainError(
      ErrorCode.NO_ALTERNATIVES,
      "No eligible alternative flights are available.",
    );
  }

  const options: FlightOption[] = alternatives.map(({ flight }, index) => ({
    optionId: `option_${index + 1}`,
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime.toISOString(),
    arrivalTime: flight.arrivalTime.toISOString(),
    connections: flight.stops,
    availableSeats: flight.availableSeats,
    additionalCost: 0,
  }));

  if (session.state !== "OPTIONS_PRESENTED") {
    assertTransitionAllowed(session.state, "OPTIONS_PRESENTED");
    await sessionRepository.transition(prisma, session.id, "OPTIONS_PRESENTED");
  }

  await auditService.record(prisma, session.id, AuditAction.ALTERNATIVES_SEARCHED, {
    count: options.length,
    directOnly: input.directOnly ?? false,
    flightNumbers: options.map((o) => o.flightNumber),
  });

  return { options };
}
