import { AuditAction, MAX_VERIFICATION_ATTEMPTS } from "../../domain/constants";
import { DomainError, ErrorCode, invalidCredentials } from "../../domain/errors";
import { assertTransitionAllowed } from "../../domain/rebooking-state";
import { normalizeName, normalizeReference } from "../../domain/rebooking";
import { prisma } from "../db/prisma";
import * as auditRepository from "../repositories/audit-repository";
import * as bookingRepository from "../repositories/booking-repository";
import * as sessionRepository from "../repositories/session-repository";
import * as auditService from "./audit-service";
import { EscalationReason, escalateSession } from "./escalation-service";

export interface CreateSessionResult {
  sessionId: string;
  state: string;
}

/**
 * A session must exist before the first verification attempt, otherwise there is
 * nowhere to count failures or write audit events.
 */
export async function createSession(
  channel: "TEXT" | "VOICE" = "TEXT",
): Promise<CreateSessionResult> {
  const session = await sessionRepository.create(prisma, channel);
  await auditService.record(prisma, session.id, AuditAction.SESSION_STARTED, { channel });
  return { sessionId: session.id, state: session.state };
}

export interface VerifyPassengerInput {
  sessionId: string;
  bookingReference: string;
  lastName: string;
}

export interface VerifyPassengerResult {
  verified: true;
  sessionId: string;
  bookingReference: string;
}

/**
 * Deliberately returns almost nothing. No email, no flight, no seat — the caller
 * must call getDisruptedBooking afterwards, which checks the session state first.
 */
export async function verifyPassenger(
  input: VerifyPassengerInput,
): Promise<VerifyPassengerResult> {
  const session = await sessionRepository.findById(prisma, input.sessionId);
  if (!session) {
    throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
  }
  if (session.state !== "UNVERIFIED") {
    throw new DomainError(ErrorCode.INVALID_STATE, "This session has already been verified.");
  }

  const reference = normalizeReference(input.bookingReference);
  const surname = normalizeName(input.lastName);

  const booking = reference ? await bookingRepository.findByReference(prisma, reference) : null;
  const matches = booking !== null && normalizeName(booking.passenger.lastName) === surname;

  if (!matches) {
    await auditService.record(prisma, session.id, AuditAction.VERIFICATION_FAILED, {
      // Never log what the caller actually said — only that an attempt happened.
      referenceProvided: reference.length > 0,
    });

    const failures = await auditRepository.countByAction(
      prisma,
      session.id,
      AuditAction.VERIFICATION_FAILED,
    );

    if (failures >= MAX_VERIFICATION_ATTEMPTS) {
      await escalateSession({
        sessionId: session.id,
        reason: EscalationReason.VERIFICATION_FAILED,
      });
    }

    throw invalidCredentials();
  }

  assertTransitionAllowed(session.state, "VERIFIED");
  await sessionRepository.transition(prisma, session.id, "VERIFIED", { bookingId: booking.id });
  await auditService.record(prisma, session.id, AuditAction.PASSENGER_VERIFIED, {
    bookingReference: booking.bookingReference,
  });

  return {
    verified: true,
    sessionId: session.id,
    bookingReference: booking.bookingReference,
  };
}
