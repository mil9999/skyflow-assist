import { createHash } from "node:crypto";

import { AuditAction, HOLD_DURATION_MINUTES } from "../../domain/constants";
import { DomainError, ErrorCode } from "../../domain/errors";
import { assertTransitionAllowed } from "../../domain/rebooking-state";
import { isAlternativeEligible, type Flight } from "../../domain/rebooking";
import { prisma, type DatabaseClient } from "../db/prisma";
import * as bookingRepository from "../repositories/booking-repository";
import * as flightRepository from "../repositories/flight-repository";
import * as holdRepository from "../repositories/hold-repository";
import * as idempotencyRepository from "../repositories/idempotency-repository";
import * as sessionRepository from "../repositories/session-repository";
import * as auditService from "./audit-service";
import { searchFloor } from "./flight-search-service";

const SEAT_LETTERS = "ABCDEF";

function assignSeat(availableSeats: number): string {
  const row = 10 + (availableSeats % 20);
  return `${row}${SEAT_LETTERS[availableSeats % SEAT_LETTERS.length]}`;
}

function hashRequest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Hold                                                                */
/* ------------------------------------------------------------------ */

export interface HoldInput {
  sessionId: string;
  flightId: string;
}

export interface HoldResult {
  holdId: string;
  flightNumber: string;
  expiresAt: string;
  requiresConfirmation: true;
}

/**
 * Reserves one seat and parks the session in AWAITING_CONFIRMATION.
 * Availability is re-checked here because the search happened seconds ago and
 * another passenger may have taken the last seat since.
 */
export async function holdAlternativeFlight(input: HoldInput): Promise<HoldResult> {
  return prisma.$transaction(async (tx) => {
    const session = await sessionRepository.findById(tx, input.sessionId);
    if (!session) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
    }
    if (session.state !== "OPTIONS_PRESENTED") {
      throw new DomainError(
        ErrorCode.INVALID_STATE,
        "Alternatives must be presented before one can be held.",
      );
    }
    if (!session.bookingId) {
      throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "No booking attached to this session.");
    }

    const booking = await bookingRepository.findById(tx, session.bookingId);
    if (!booking) {
      throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "Booking not found.");
    }
    if (booking.status === "REBOOKED") {
      throw new DomainError(ErrorCode.ALREADY_REBOOKED, "This booking has already been changed.");
    }

    const candidate = await flightRepository.findById(tx, input.flightId);
    if (!candidate) {
      throw new DomainError(ErrorCode.FLIGHT_UNAVAILABLE, "That flight is not available.");
    }

    const original = booking.flight as Flight;
    const decision = isAlternativeEligible(original, candidate as Flight, {
      now: searchFloor(original.departureTime),
    });
    if (!decision.ok) {
      throw new DomainError(
        ErrorCode.FLIGHT_UNAVAILABLE,
        "That flight can no longer be offered for this booking.",
      );
    }

    const reserved = await flightRepository.reserveSeat(tx, candidate.id);
    if (!reserved) {
      throw new DomainError(ErrorCode.FLIGHT_UNAVAILABLE, "That flight just sold out.");
    }

    const expiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60_000);
    const hold = await holdRepository.create(tx, {
      bookingId: booking.id,
      newFlightId: candidate.id,
      expiresAt,
    });

    assertTransitionAllowed(session.state, "OPTION_HELD");
    await sessionRepository.transition(tx, session.id, "OPTION_HELD", { activeHoldId: hold.id });

    // The passenger must now say yes out loud before anything is committed.
    assertTransitionAllowed("OPTION_HELD", "AWAITING_CONFIRMATION");
    await sessionRepository.transition(tx, session.id, "AWAITING_CONFIRMATION");

    await auditService.record(tx, session.id, AuditAction.FLIGHT_HELD, {
      holdId: hold.id,
      flightNumber: candidate.flightNumber,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      holdId: hold.id,
      flightNumber: candidate.flightNumber,
      expiresAt: expiresAt.toISOString(),
      requiresConfirmation: true as const,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

export interface ConfirmInput {
  sessionId: string;
  holdId: string;
  confirmed: boolean;
  idempotencyKey: string;
}

export interface ConfirmResult {
  success: true;
  bookingReference: string;
  newFlight: {
    flightNumber: string;
    seatNumber: string;
    departureTime: string;
    arrivalTime: string;
  };
}

export async function confirmRebooking(input: ConfirmInput): Promise<ConfirmResult> {
  const requestHash = hashRequest({
    sessionId: input.sessionId,
    holdId: input.holdId,
    confirmed: input.confirmed,
  });

  // Replay protection first: a retried webhook must not touch inventory again.
  const existing = await idempotencyRepository.findByKey(prisma, input.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError(
        ErrorCode.IDEMPOTENCY_MISMATCH,
        "That idempotency key was already used with different confirmation data.",
      );
    }
    return JSON.parse(existing.responseJson ?? "null") as ConfirmResult;
  }

  if (input.confirmed !== true) {
    throw new DomainError(
      ErrorCode.CONFIRMATION_REQUIRED,
      "The passenger must explicitly confirm the change.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const session = await sessionRepository.findById(tx, input.sessionId);
    if (!session) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
    }
    if (!session.bookingId) {
      throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "No booking attached to this session.");
    }

    const booking = await bookingRepository.findById(tx, session.bookingId);
    if (!booking) {
      throw new DomainError(ErrorCode.BOOKING_NOT_FOUND, "Booking not found.");
    }
    // Checked before the state guard so a genuine double-book attempt gets the
    // specific error rather than a generic one.
    if (booking.status === "REBOOKED") {
      throw new DomainError(ErrorCode.ALREADY_REBOOKED, "This booking has already been changed.");
    }
    if (session.state !== "AWAITING_CONFIRMATION") {
      throw new DomainError(
        ErrorCode.INVALID_STATE,
        "There is no held flight awaiting confirmation.",
      );
    }

    const hold = await holdRepository.findById(tx, input.holdId);
    if (!hold || hold.bookingId !== booking.id || session.activeHoldId !== hold.id) {
      throw new DomainError(ErrorCode.INVALID_STATE, "That hold does not belong to this session.");
    }
    if (hold.status === "CONFIRMED") {
      throw new DomainError(ErrorCode.ALREADY_REBOOKED, "This hold was already confirmed.");
    }
    if (hold.status !== "ACTIVE" || hold.expiresAt.getTime() <= Date.now()) {
      throw new DomainError(
        ErrorCode.HOLD_EXPIRED,
        "That seat hold has expired. Let me look again.",
      );
    }

    const newFlight = await flightRepository.findById(tx, hold.newFlightId);
    if (!newFlight) {
      throw new DomainError(ErrorCode.FLIGHT_UNAVAILABLE, "That flight is no longer available.");
    }

    const seatNumber = assignSeat(newFlight.availableSeats);

    await bookingRepository.rebook(tx, {
      bookingId: booking.id,
      newFlightId: newFlight.id,
      seatNumber,
    });
    await holdRepository.confirm(tx, hold.id);

    assertTransitionAllowed(session.state, "REBOOKED");
    await sessionRepository.transition(tx, session.id, "REBOOKED");

    const result: ConfirmResult = {
      success: true,
      bookingReference: booking.bookingReference,
      newFlight: {
        flightNumber: newFlight.flightNumber,
        seatNumber,
        departureTime: newFlight.departureTime.toISOString(),
        arrivalTime: newFlight.arrivalTime.toISOString(),
      },
    };

    await auditService.record(tx, session.id, AuditAction.REBOOKING_CONFIRMED, {
      bookingReference: booking.bookingReference,
      flightNumber: newFlight.flightNumber,
      seatNumber,
      holdId: hold.id,
    });

    await idempotencyRepository.create(tx, {
      key: input.idempotencyKey,
      operation: "confirmRebooking",
      sessionId: session.id,
      requestHash,
      responseJson: JSON.stringify(result),
    });

    return result;
  });
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

type ReleaseStatus = "CANCELLED" | "EXPIRED";

interface ReleasableHold {
  id: string;
  newFlightId: string;
}

interface RewindableSession {
  id: string;
  state: string;
}

/**
 * The one place a held seat goes back into inventory. Cancellation and expiry
 * both route through here so the two paths cannot drift apart.
 */
async function releaseAndRewind(
  tx: DatabaseClient,
  hold: ReleasableHold,
  session: RewindableSession | null,
  status: ReleaseStatus,
): Promise<void> {
  await holdRepository.setStatus(tx, hold.id, status);
  await flightRepository.releaseSeat(tx, hold.newFlightId);

  if (session) {
    if (session.state === "OPTION_HELD" || session.state === "AWAITING_CONFIRMATION") {
      assertTransitionAllowed(session.state, "OPTIONS_PRESENTED");
      await sessionRepository.transition(tx, session.id, "OPTIONS_PRESENTED", {
        activeHoldId: null,
      });
    }

    await auditService.record(
      tx,
      session.id,
      status === "CANCELLED" ? AuditAction.HOLD_CANCELLED : AuditAction.HOLD_EXPIRED,
      { holdId: hold.id, flightId: hold.newFlightId, status },
    );
  }
}

export interface CancelHoldInput {
  sessionId: string;
  holdId: string;
}

export interface CancelHoldResult {
  holdId: string;
  status: ReleaseStatus;
  seatReleased: boolean;
  state: "OPTIONS_PRESENTED";
}

/**
 * "No, not that one — show me something else."
 *
 * Distinct from confirmRebooking({ confirmed: false }), which stays strictly a
 * refusal to act rather than a way to decline a flight.
 */
export async function cancelHold(input: CancelHoldInput): Promise<CancelHoldResult> {
  return prisma.$transaction(async (tx) => {
    const session = await sessionRepository.findById(tx, input.sessionId);
    if (!session) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
    }

    const hold = await holdRepository.findById(tx, input.holdId);
    if (!hold) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown hold.");
    }
    if (!session.bookingId || hold.bookingId !== session.bookingId) {
      throw new DomainError(ErrorCode.INVALID_STATE, "That hold does not belong to this session.");
    }
    if (hold.status === "CONFIRMED") {
      throw new DomainError(ErrorCode.ALREADY_REBOOKED, "That change has already been made.");
    }

    // Already released. Return the same shape without touching inventory again.
    if (hold.status !== "ACTIVE") {
      if (session.state === "OPTION_HELD" || session.state === "AWAITING_CONFIRMATION") {
        assertTransitionAllowed(session.state, "OPTIONS_PRESENTED");
        await sessionRepository.transition(tx, session.id, "OPTIONS_PRESENTED", {
          activeHoldId: null,
        });
      }
      return {
        holdId: hold.id,
        status: hold.status as ReleaseStatus,
        seatReleased: false,
        state: "OPTIONS_PRESENTED" as const,
      };
    }

    if (session.activeHoldId !== hold.id) {
      throw new DomainError(ErrorCode.INVALID_STATE, "That hold is not the active one.");
    }

    const status: ReleaseStatus = hold.expiresAt.getTime() <= Date.now() ? "EXPIRED" : "CANCELLED";
    await releaseAndRewind(tx, hold, session, status);

    return {
      holdId: hold.id,
      status,
      seatReleased: true,
      state: "OPTIONS_PRESENTED" as const,
    };
  });
}

export interface ExpireHoldInput {
  holdId: string;
}

export interface ExpireHoldResult {
  holdId: string;
  seatReleased: boolean;
  sessionId: string | null;
}

/**
 * Releases the reserved seat and puts the conversation back in front of the
 * option list. n8n will call this on a timer in a later phase.
 */
export async function expireHold(input: ExpireHoldInput): Promise<ExpireHoldResult> {
  return prisma.$transaction(async (tx) => {
    const hold = await holdRepository.findById(tx, input.holdId);
    if (!hold) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown hold.");
    }
    if (hold.status !== "ACTIVE") {
      throw new DomainError(ErrorCode.INVALID_STATE, "Only an active hold can expire.");
    }

    const session = await sessionRepository.findByActiveHold(tx, hold.id);
    await releaseAndRewind(tx, hold, session, "EXPIRED");

    return {
      holdId: hold.id,
      seatReleased: true,
      sessionId: session?.id ?? null,
    };
  });
}

/** Convenience sweep for the scheduler. */
export async function expireDueHolds(now: Date = new Date()): Promise<string[]> {
  const due = await holdRepository.findDue(prisma, now);
  const expired: string[] = [];
  for (const hold of due) {
    await expireHold({ holdId: hold.id });
    expired.push(hold.id);
  }
  return expired;
}
