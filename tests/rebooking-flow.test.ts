import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db/prisma";
import { getDisruptedBooking } from "../src/server/services/booking-service";
import { EscalationReason, escalateSession } from "../src/server/services/escalation-service";
import { searchAlternativeFlights } from "../src/server/services/flight-search-service";
import {
  confirmRebooking,
  expireHold,
  holdAlternativeFlight,
} from "../src/server/services/rebooking-service";
import { createSession, verifyPassenger } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario, type Fixture } from "./helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fx = await seedScenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Asserts the promise rejects with a specific DomainError code. */
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

async function verifiedSession(reference = "SKY82Q", surname = "Martin") {
  const { sessionId } = await createSession();
  await verifyPassenger({ sessionId, bookingReference: reference, lastName: surname });
  return sessionId;
}

async function sessionWithOptions() {
  const sessionId = await verifiedSession();
  await getDisruptedBooking({ sessionId });
  const search = await searchAlternativeFlights({ sessionId });
  return { sessionId, search };
}

async function sessionAwaitingConfirmation() {
  const { sessionId } = await sessionWithOptions();
  const hold = await holdAlternativeFlight({ sessionId, flightId: fx.flights.SF218.id });
  return { sessionId, hold };
}

const auditActions = async (sessionId: string) =>
  (await prisma.auditEvent.findMany({ where: { sessionId } })).map((e) => e.action).sort();

const seatsOn = async (flightNumber: string) =>
  (await prisma.flight.findUnique({ where: { flightNumber } }))!.availableSeats;

/* ------------------------------------------------------------------ */

describe("happy path", () => {
  it("carries Emma from a cancelled flight to a confirmed rebooking", async () => {
    const { sessionId } = await createSession();

    // Messy speech-to-text input still verifies.
    const verification = await verifyPassenger({
      sessionId,
      bookingReference: "sky 82 q",
      lastName: " martin ",
    });
    expect(verification).toEqual({ verified: true, sessionId, bookingReference: "SKY82Q" });

    const booking = await getDisruptedBooking({ sessionId });
    expect(booking.bookingReference).toBe("SKY82Q");
    expect(booking.flight.flightNumber).toBe("SF204");
    expect(booking.flight.status).toBe("CANCELLED");
    expect(booking.disruption).toEqual({
      type: "CANCELLATION",
      reason: "Aircraft operational issue",
    });

    const search = await searchAlternativeFlights({ sessionId });
    expect(search.options.map((o) => o.flightNumber)).toEqual(["SF218", "SF224", "SF310"]);
    expect(search.options[0]).toMatchObject({
      optionId: "option_1",
      connections: 0,
      availableSeats: 17,
      additionalCost: 0,
    });

    const hold = await holdAlternativeFlight({ sessionId, flightId: fx.flights.SF218.id });
    expect(hold.flightNumber).toBe("SF218");
    expect(hold.requiresConfirmation).toBe(true);
    expect(await seatsOn("SF218")).toBe(16); // inventory actually moved

    const result = await confirmRebooking({
      sessionId,
      holdId: hold.holdId,
      confirmed: true,
      idempotencyKey: "call-1-confirm",
    });
    expect(result.success).toBe(true);
    expect(result.bookingReference).toBe("SKY82Q");
    expect(result.newFlight.flightNumber).toBe("SF218");
    expect(result.newFlight.seatNumber).toMatch(/^\d{2}[A-F]$/);

    const stored = await prisma.booking.findUnique({ where: { bookingReference: "SKY82Q" } });
    expect(stored?.flightId).toBe(fx.flights.SF218.id);
    expect(stored?.status).toBe("REBOOKED");

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("REBOOKED");

    expect(await auditActions(sessionId)).toEqual(
      [
        "SESSION_STARTED",
        "PASSENGER_VERIFIED",
        "BOOKING_RETRIEVED",
        "ALTERNATIVES_SEARCHED",
        "FLIGHT_HELD",
        "REBOOKING_CONFIRMED",
      ].sort(),
    );
  });
});

describe("verification", () => {
  it("rejects an unknown booking reference without saying why", async () => {
    const { sessionId } = await createSession();
    await expectCode(
      verifyPassenger({ sessionId, bookingReference: "SKY000", lastName: "Martin" }),
      "INVALID_CREDENTIALS",
    );
    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("UNVERIFIED");
  });

  it("rejects an incorrect surname with the same generic error", async () => {
    const { sessionId } = await createSession();
    await expectCode(
      verifyPassenger({ sessionId, bookingReference: "SKY82Q", lastName: "Dubois" }),
      "INVALID_CREDENTIALS",
    );
  });

  it("escalates to a human after two failed attempts", async () => {
    const { sessionId } = await createSession();
    await expectCode(
      verifyPassenger({ sessionId, bookingReference: "SKY82Q", lastName: "Dubois" }),
      "INVALID_CREDENTIALS",
    );
    await expectCode(
      verifyPassenger({ sessionId, bookingReference: "SKY82Q", lastName: "Duval" }),
      "INVALID_CREDENTIALS",
    );

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("ESCALATED");

    const cases = await prisma.supportCase.findMany({ where: { sessionId } });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      reason: "VERIFICATION_FAILED",
      escalatedFromState: "UNVERIFIED",
      status: "OPEN",
    });
  });

  it("keeps booking data hidden until verification succeeds", async () => {
    const { sessionId } = await createSession();
    await expectCode(getDisruptedBooking({ sessionId }), "INVALID_STATE");
  });
});

describe("booking retrieval", () => {
  it("refuses a booking that is not disrupted", async () => {
    const sessionId = await verifiedSession("SKY19M", "Rossi");
    await expectCode(getDisruptedBooking({ sessionId }), "BOOKING_NOT_DISRUPTED");
  });
});

describe("alternative search", () => {
  it("reports when nothing is available", async () => {
    const sessionId = await verifiedSession("SKY55T", "Okafor");
    await getDisruptedBooking({ sessionId });
    await expectCode(searchAlternativeFlights({ sessionId }), "NO_ALTERNATIVES");
  });

  it("honours directOnly and latestArrivalTime", async () => {
    const sessionId = await verifiedSession();
    await getDisruptedBooking({ sessionId });

    const direct = await searchAlternativeFlights({ sessionId, directOnly: true });
    expect(direct.options.map((o) => o.flightNumber)).toEqual(["SF218", "SF224"]);

    const early = await searchAlternativeFlights({ sessionId, latestArrivalTime: fx.at(400) });
    expect(early.options.map((o) => o.flightNumber)).toEqual(["SF218"]);
  });

  it("cannot run before the booking is loaded", async () => {
    const sessionId = await verifiedSession();
    await expectCode(searchAlternativeFlights({ sessionId }), "INVALID_STATE");
  });
});

describe("holding", () => {
  it("fails cleanly if the last seat goes between search and hold", async () => {
    const { sessionId } = await sessionWithOptions();

    await prisma.flight.update({
      where: { flightNumber: "SF218" },
      data: { availableSeats: 0 },
    });

    await expectCode(
      holdAlternativeFlight({ sessionId, flightId: fx.flights.SF218.id }),
      "FLIGHT_UNAVAILABLE",
    );

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("OPTIONS_PRESENTED"); // rolled back
  });

  it("refuses a flight that was never eligible", async () => {
    const { sessionId } = await sessionWithOptions();
    await expectCode(
      holdAlternativeFlight({ sessionId, flightId: fx.flights.SF228.id }),
      "FLIGHT_UNAVAILABLE",
    );
  });

  it("releases the seat and rewinds the conversation when a hold expires", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();
    expect(await seatsOn("SF218")).toBe(16);

    const expired = await expireHold({ holdId: hold.holdId });
    expect(expired.seatReleased).toBe(true);
    expect(await seatsOn("SF218")).toBe(17);

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("OPTIONS_PRESENTED");
    expect(session?.activeHoldId).toBeNull();

    const stored = await prisma.rebookingHold.findUnique({ where: { id: hold.holdId } });
    expect(stored?.status).toBe("EXPIRED");
    expect(await auditActions(sessionId)).toContain("HOLD_EXPIRED");
  });
});

describe("confirmation", () => {
  it("refuses to rebook without an explicit yes", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();

    await expectCode(
      confirmRebooking({
        sessionId,
        holdId: hold.holdId,
        confirmed: false,
        idempotencyKey: "no-thanks",
      }),
      "CONFIRMATION_REQUIRED",
    );

    const booking = await prisma.booking.findUnique({ where: { bookingReference: "SKY82Q" } });
    expect(booking?.status).toBe("DISRUPTED");
  });

  it("refuses to rebook against an expired hold", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();

    await prisma.rebookingHold.update({
      where: { id: hold.holdId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expectCode(
      confirmRebooking({
        sessionId,
        holdId: hold.holdId,
        confirmed: true,
        idempotencyKey: "too-late",
      }),
      "HOLD_EXPIRED",
    );
  });

  it("replays the same idempotency key without touching inventory twice", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();
    const args = {
      sessionId,
      holdId: hold.holdId,
      confirmed: true,
      idempotencyKey: "retry-me",
    } as const;

    const first = await confirmRebooking({ ...args });
    const seatsAfterFirst = await seatsOn("SF218");

    const second = await confirmRebooking({ ...args });
    expect(second).toEqual(first);
    expect(await seatsOn("SF218")).toBe(seatsAfterFirst);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
  });

  it("rejects the same key reused with different confirmation data", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();
    await confirmRebooking({
      sessionId,
      holdId: hold.holdId,
      confirmed: true,
      idempotencyKey: "shared-key",
    });

    await expectCode(
      confirmRebooking({
        sessionId,
        holdId: "some-other-hold",
        confirmed: true,
        idempotencyKey: "shared-key",
      }),
      "IDEMPOTENCY_MISMATCH",
    );
  });

  it("refuses a genuine second rebooking under a fresh key", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();
    await confirmRebooking({
      sessionId,
      holdId: hold.holdId,
      confirmed: true,
      idempotencyKey: "first-key",
    });

    await expectCode(
      confirmRebooking({
        sessionId,
        holdId: hold.holdId,
        confirmed: true,
        idempotencyKey: "second-key",
      }),
      "ALREADY_REBOOKED",
    );
  });
});

describe("escalation", () => {
  it("can be reached from every non-terminal state", async () => {
    // UNVERIFIED
    const fresh = await createSession();
    const a = await escalateSession({
      sessionId: fresh.sessionId,
      reason: EscalationReason.PASSENGER_REQUEST,
    });
    expect(a.escalatedFromState).toBe("UNVERIFIED");

    // VERIFIED
    const verified = await verifiedSession();
    const b = await escalateSession({
      sessionId: verified,
      reason: EscalationReason.POLICY_EXCEPTION,
    });
    expect(b.escalatedFromState).toBe("VERIFIED");

    // BOOKING_LOADED
    const loaded = await verifiedSession();
    await getDisruptedBooking({ sessionId: loaded });
    const c = await escalateSession({
      sessionId: loaded,
      reason: EscalationReason.BACKEND_ERROR,
    });
    expect(c.escalatedFromState).toBe("BOOKING_LOADED");

    // OPTIONS_PRESENTED
    const { sessionId: presented } = await sessionWithOptions();
    const d = await escalateSession({
      sessionId: presented,
      reason: EscalationReason.NO_ALTERNATIVE_FLIGHTS,
    });
    expect(d.escalatedFromState).toBe("OPTIONS_PRESENTED");

    // OPTION_HELD (forced, since holding walks straight on to AWAITING_CONFIRMATION)
    const { sessionId: held } = await sessionAwaitingConfirmation();
    await prisma.conversationSession.update({
      where: { id: held },
      data: { state: "OPTION_HELD" },
    });
    const e = await escalateSession({
      sessionId: held,
      reason: EscalationReason.PASSENGER_REQUEST,
    });
    expect(e.escalatedFromState).toBe("OPTION_HELD");

    // AWAITING_CONFIRMATION
    const { sessionId: awaiting } = await sessionAwaitingConfirmation();
    const f = await escalateSession({
      sessionId: awaiting,
      reason: EscalationReason.PASSENGER_REQUEST,
    });
    expect(f.escalatedFromState).toBe("AWAITING_CONFIRMATION");

    for (const sessionId of [fresh.sessionId, verified, loaded, presented, held, awaiting]) {
      const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
      expect(session?.state).toBe("ESCALATED");
      expect(await auditActions(sessionId)).toContain("HUMAN_TRANSFER_REQUESTED");
    }
  });

  it("cannot escalate a completed rebooking", async () => {
    const { sessionId, hold } = await sessionAwaitingConfirmation();
    await confirmRebooking({
      sessionId,
      holdId: hold.holdId,
      confirmed: true,
      idempotencyKey: "done",
    });

    await expectCode(
      escalateSession({ sessionId, reason: EscalationReason.PASSENGER_REQUEST }),
      "INVALID_STATE",
    );
  });
});
