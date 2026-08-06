import { describe, expect, it } from "vitest";
import {
  canConfirmRebooking,
  canHoldFlight,
  canTransition,
  findAlternatives,
  isBookingDisrupted,
  isHoldValid,
  normalizeReference,
  rebookingIdempotencyKey,
  verifyPassenger,
  type Booking,
  type Flight,
  type Passenger,
  type RebookingHold,
  type Session,
} from "../src/domain/rebooking";

const NOW = new Date("2026-08-14T10:00:00.000Z");
const at = (time: string) => new Date(`2026-08-14T${time}:00.000Z`);

const flight = (over: Partial<Flight> & { flightNumber: string }): Flight => ({
  id: over.flightNumber,
  origin: "LHR",
  destination: "CDG",
  departureTime: at("13:00"),
  arrivalTime: at("15:15"),
  availableSeats: 10,
  stops: 0,
  status: "SCHEDULED",
  ...over,
});

const SF204 = flight({
  flightNumber: "SF204",
  departureTime: at("09:30"),
  arrivalTime: at("11:45"),
  availableSeats: 0,
  status: "CANCELLED",
});
const SF218 = flight({ flightNumber: "SF218", availableSeats: 17 });
const SF224 = flight({ flightNumber: "SF224", departureTime: at("17:30"), arrivalTime: at("19:45"), availableSeats: 4 });
const SF310 = flight({ flightNumber: "SF310", departureTime: at("14:00"), arrivalTime: at("18:40"), availableSeats: 9, stops: 1 });
const SF228_NO_SEATS = flight({ flightNumber: "SF228", departureTime: at("20:15"), arrivalTime: at("22:30"), availableSeats: 0 });
const SF648_CANCELLED = flight({ flightNumber: "SF648", departureTime: at("19:00"), arrivalTime: at("22:20"), status: "CANCELLED" });
const SF120_WRONG_DEST = flight({ flightNumber: "SF120", destination: "JFK", arrivalTime: at("18:00") });
const SF900_PAST = flight({ flightNumber: "SF900", departureTime: at("08:00"), arrivalTime: at("09:30") });

const EMMA: Passenger = { id: "p1", firstName: "Emma", lastName: "Martin" };
const BOOKING: Booking = {
  id: "b1",
  bookingReference: "SKY82Q",
  passengerId: "p1",
  flightId: "SF204",
  seatNumber: "14A",
  status: "DISRUPTED",
};

const ALL = [SF204, SF218, SF224, SF310, SF228_NO_SEATS, SF648_CANCELLED, SF120_WRONG_DEST, SF900_PAST];
const numbers = (fs: { flight: Flight }[]) => fs.map((o) => o.flight.flightNumber);

describe("verification", () => {
  it("accepts the correct reference and surname", () => {
    expect(verifyPassenger({ bookingReference: "SKY82Q", lastName: "Martin" }, BOOKING, EMMA).ok).toBe(true);
  });

  it("tolerates messy speech-to-text output", () => {
    expect(normalizeReference("sky 82 q")).toBe("SKY82Q");
    expect(verifyPassenger({ bookingReference: "sky-82 q", lastName: " martin " }, BOOKING, EMMA).ok).toBe(true);
  });

  it("rejects an invalid booking reference", () => {
    const result = verifyPassenger({ bookingReference: "SKY000", lastName: "Martin" }, BOOKING, EMMA);
    expect(result).toEqual({ ok: false, reason: "BOOKING_NOT_FOUND" });
  });

  it("rejects an incorrect surname", () => {
    const result = verifyPassenger({ bookingReference: "SKY82Q", lastName: "Dubois" }, BOOKING, EMMA);
    expect(result).toEqual({ ok: false, reason: "SURNAME_MISMATCH" });
  });
});

describe("disruption detection", () => {
  it("flags a cancelled flight as disrupted", () => {
    expect(isBookingDisrupted(BOOKING, SF204)).toBe(true);
  });

  it("does not flag a healthy flight", () => {
    expect(isBookingDisrupted({ ...BOOKING, flightId: "SF218", status: "ACTIVE" }, SF218)).toBe(false);
  });
});

describe("alternative search", () => {
  it("returns direct flights first, then earliest arrival", () => {
    expect(numbers(findAlternatives(SF204, ALL, { now: NOW }))).toEqual(["SF218", "SF224", "SF310"]);
  });

  it("excludes cancelled flights, full flights, wrong destinations and departed flights", () => {
    const offered = numbers(findAlternatives(SF204, ALL, { now: NOW }));
    expect(offered).not.toContain("SF648");
    expect(offered).not.toContain("SF228");
    expect(offered).not.toContain("SF120");
    expect(offered).not.toContain("SF900");
    expect(offered).not.toContain("SF204");
  });

  it("honours directOnly", () => {
    expect(numbers(findAlternatives(SF204, ALL, { now: NOW, directOnly: true }))).toEqual(["SF218", "SF224"]);
  });

  it("honours latestArrivalTime", () => {
    expect(numbers(findAlternatives(SF204, ALL, { now: NOW, latestArrivalTime: at("16:00") }))).toEqual(["SF218"]);
  });

  it("returns nothing when no alternative qualifies", () => {
    expect(findAlternatives(SF204, [SF228_NO_SEATS, SF648_CANCELLED], { now: NOW })).toHaveLength(0);
  });

  it("never presents more than three options", () => {
    const many = ["SF401", "SF402", "SF403", "SF404", "SF405"].map((n, i) =>
      flight({ flightNumber: n, departureTime: at("13:00"), arrivalTime: new Date(at("15:00").getTime() + i * 60_000) }),
    );
    expect(findAlternatives(SF204, many, { now: NOW })).toHaveLength(3);
  });
});

describe("holding a seat", () => {
  it("prevents holding an unavailable flight", () => {
    expect(canHoldFlight(SF204, SF228_NO_SEATS, BOOKING, { now: NOW })).toEqual({ ok: false, reason: "NO_SEATS" });
  });

  it("allows holding an eligible flight", () => {
    expect(canHoldFlight(SF204, SF218, BOOKING, { now: NOW }).ok).toBe(true);
  });

  it("rejects an expired hold", () => {
    const expired: RebookingHold = { id: "h1", bookingId: "b1", newFlightId: "SF218", status: "ACTIVE", expiresAt: at("09:55") };
    expect(isHoldValid(expired, NOW)).toEqual({ ok: false, reason: "HOLD_EXPIRED" });
  });
});

describe("confirmation", () => {
  const session: Session = { id: "s1", bookingId: "b1", state: "OPTION_HELD" };
  const hold: RebookingHold = { id: "h1", bookingId: "b1", newFlightId: "SF218", status: "ACTIVE", expiresAt: at("10:10") };

  it("confirms with an active hold and explicit consent", () => {
    expect(canConfirmRebooking(session, BOOKING, hold, true, NOW).ok).toBe(true);
  });

  it("refuses to confirm without a hold", () => {
    expect(canConfirmRebooking(session, BOOKING, null, true, NOW)).toEqual({ ok: false, reason: "NO_HOLD" });
  });

  it("refuses to confirm without explicit passenger consent", () => {
    expect(canConfirmRebooking(session, BOOKING, hold, false, NOW)).toEqual({ ok: false, reason: "NO_EXPLICIT_CONFIRMATION" });
  });

  it("refuses to confirm from the wrong state", () => {
    expect(canConfirmRebooking({ ...session, state: "UNVERIFIED" }, BOOKING, hold, true, NOW)).toEqual({
      ok: false,
      reason: "WRONG_STATE",
    });
  });

  it("does not rebook twice", () => {
    expect(canConfirmRebooking(session, { ...BOOKING, status: "REBOOKED" }, hold, true, NOW)).toEqual({
      ok: false,
      reason: "ALREADY_REBOOKED",
    });
    expect(canConfirmRebooking(session, BOOKING, { ...hold, status: "CONFIRMED" }, true, NOW)).toEqual({
      ok: false,
      reason: "HOLD_ALREADY_CONFIRMED",
    });
    expect(rebookingIdempotencyKey("b1", "SF218")).toBe("rebook:b1:SF218");
  });

  it("blocks confirmation after escalation", () => {
    expect(canConfirmRebooking({ ...session, state: "ESCALATED" }, BOOKING, hold, true, NOW)).toEqual({
      ok: false,
      reason: "SESSION_ESCALATED",
    });
  });
});

describe("state machine", () => {
  it("allows only the intended transitions", () => {
    expect(canTransition("UNVERIFIED", "VERIFIED")).toBe(true);
    expect(canTransition("AWAITING_CONFIRMATION", "REBOOKED")).toBe(true);
    expect(canTransition("UNVERIFIED", "REBOOKED")).toBe(false);
    expect(canTransition("REBOOKED", "OPTIONS_PRESENTED")).toBe(false);
  });

  it("can escalate from every non-terminal state", () => {
    for (const state of ["UNVERIFIED", "VERIFIED", "BOOKING_LOADED", "OPTIONS_PRESENTED", "OPTION_HELD", "AWAITING_CONFIRMATION"]) {
      expect(canTransition(state, "ESCALATED")).toBe(true);
    }
  });
});
