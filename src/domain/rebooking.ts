/**
 * Pure domain rules for SkyFlow Assist.
 * No database, no network, no LLM. Everything here is deterministic and unit-testable.
 * The voice agent may only *describe* what these functions return.
 */
import {
  BookingStatus,
  FlightStatus,
  HoldStatus,
  MAX_OPTIONS_PRESENTED,
  SessionState,
} from "./constants";

export interface Passenger {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Flight {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: Date;
  arrivalTime: Date;
  availableSeats: number;
  stops: number;
  status: string;
}

export interface Booking {
  id: string;
  bookingReference: string;
  passengerId: string;
  flightId: string;
  seatNumber?: string | null;
  status: string;
}

export interface RebookingHold {
  id: string;
  bookingId: string;
  newFlightId: string;
  status: string;
  expiresAt: Date;
}

export interface Session {
  id: string;
  bookingId?: string | null;
  state: string;
}

export type Decision = { ok: true } | { ok: false; reason: string };

const allow = (): Decision => ({ ok: true });
const deny = (reason: string): Decision => ({ ok: false, reason });

/* ------------------------------------------------------------------ */
/* Normalisation - speech-to-text output is messy                      */
/* ------------------------------------------------------------------ */

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** "sky 82 q" / "sky-82q" -> "SKY82Q" */
export function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export function verifyPassenger(
  input: { bookingReference: string; lastName: string },
  booking: Booking | null,
  passenger: Passenger | null,
): Decision {
  if (!booking || !passenger) return deny("BOOKING_NOT_FOUND");
  if (normalizeReference(input.bookingReference) !== normalizeReference(booking.bookingReference)) {
    return deny("BOOKING_NOT_FOUND");
  }
  if (normalizeName(input.lastName) !== normalizeName(passenger.lastName)) {
    return deny("SURNAME_MISMATCH");
  }
  if (booking.status === BookingStatus.CANCELLED) return deny("BOOKING_CANCELLED");
  return allow();
}

/* ------------------------------------------------------------------ */
/* Disruption detection                                                */
/* ------------------------------------------------------------------ */

export function isBookingDisrupted(booking: Booking, flight: Flight): boolean {
  if (booking.flightId !== flight.id) return false;
  if (booking.status === BookingStatus.REBOOKED) return false;
  return flight.status === FlightStatus.CANCELLED || flight.status === FlightStatus.DELAYED;
}

/* ------------------------------------------------------------------ */
/* Alternative eligibility                                             */
/* ------------------------------------------------------------------ */

export interface SearchPreferences {
  latestArrivalTime?: Date;
  directOnly?: boolean;
  now?: Date;
}

export function isAlternativeEligible(
  original: Flight,
  candidate: Flight,
  prefs: SearchPreferences = {},
): Decision {
  const now = prefs.now ?? new Date();

  if (candidate.id === original.id) return deny("SAME_FLIGHT");
  if (candidate.status !== FlightStatus.SCHEDULED) return deny("NOT_SCHEDULED");
  if (candidate.origin !== original.origin) return deny("ORIGIN_MISMATCH");
  if (candidate.destination !== original.destination) return deny("DESTINATION_MISMATCH");
  if (candidate.availableSeats < 1) return deny("NO_SEATS");
  if (candidate.departureTime.getTime() <= now.getTime()) return deny("ALREADY_DEPARTED");
  if (candidate.arrivalTime.getTime() <= candidate.departureTime.getTime()) {
    return deny("INVALID_TIMES");
  }
  if (prefs.directOnly && candidate.stops > 0) return deny("NOT_DIRECT");
  if (prefs.latestArrivalTime && candidate.arrivalTime.getTime() > prefs.latestArrivalTime.getTime()) {
    return deny("ARRIVES_TOO_LATE");
  }
  return allow();
}

export interface AlternativeOption {
  optionId: string;
  flight: Flight;
}

/**
 * Direct flights first, then earliest arrival, then earliest departure, then
 * flight number so ties are deterministic. Never returns more than
 * MAX_OPTIONS_PRESENTED.
 */
export function findAlternatives(
  original: Flight,
  candidates: Flight[],
  prefs: SearchPreferences = {},
): AlternativeOption[] {
  return candidates
    .filter((c) => isAlternativeEligible(original, c, prefs).ok)
    .sort(
      (a, b) =>
        a.stops - b.stops ||
        a.arrivalTime.getTime() - b.arrivalTime.getTime() ||
        a.departureTime.getTime() - b.departureTime.getTime() ||
        a.flightNumber.localeCompare(b.flightNumber),
    )
    .slice(0, MAX_OPTIONS_PRESENTED)
    .map((flight) => ({ optionId: `OPT-${flight.flightNumber}`, flight }));
}

/* ------------------------------------------------------------------ */
/* Holding a seat                                                      */
/* ------------------------------------------------------------------ */

export function canHoldFlight(
  original: Flight,
  candidate: Flight,
  booking: Booking,
  prefs: SearchPreferences = {},
): Decision {
  if (booking.status === BookingStatus.REBOOKED) return deny("ALREADY_REBOOKED");
  return isAlternativeEligible(original, candidate, prefs);
}

export function isHoldValid(hold: RebookingHold | null, now: Date = new Date()): Decision {
  if (!hold) return deny("NO_HOLD");
  if (hold.status === HoldStatus.CONFIRMED) return deny("HOLD_ALREADY_CONFIRMED");
  if (hold.status !== HoldStatus.ACTIVE) return deny("HOLD_NOT_ACTIVE");
  if (hold.expiresAt.getTime() <= now.getTime()) return deny("HOLD_EXPIRED");
  return allow();
}

/* ------------------------------------------------------------------ */
/* Confirmation - the only state-changing gate                         */
/* ------------------------------------------------------------------ */

export function canConfirmRebooking(
  session: Session,
  booking: Booking,
  hold: RebookingHold | null,
  passengerConfirmed: boolean,
  now: Date = new Date(),
): Decision {
  if (booking.status === BookingStatus.REBOOKED) return deny("ALREADY_REBOOKED");
  if (session.state === SessionState.ESCALATED) return deny("SESSION_ESCALATED");
  if (session.state !== SessionState.OPTION_HELD && session.state !== SessionState.AWAITING_CONFIRMATION) {
    return deny("WRONG_STATE");
  }
  const holdCheck = isHoldValid(hold, now);
  if (!holdCheck.ok) return holdCheck;
  if (!passengerConfirmed) return deny("NO_EXPLICIT_CONFIRMATION");
  return allow();
}

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

// Single source of truth lives in rebooking-state.ts; re-exported for convenience.
export { allowedTransitions, assertTransitionAllowed, canTransition } from "./rebooking-state";

/** Idempotency key so a repeated confirm_rebooking tool call cannot rebook twice. */
export function rebookingIdempotencyKey(bookingId: string, newFlightId: string): string {
  return `rebook:${bookingId}:${newFlightId}`;
}
