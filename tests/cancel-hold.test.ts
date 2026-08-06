import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db/prisma";
import { POST as cancelHoldRoute } from "../src/app/api/tools/cancel-hold/route";
import { getDisruptedBooking } from "../src/server/services/booking-service";
import { searchAlternativeFlights } from "../src/server/services/flight-search-service";
import {
  cancelHold,
  confirmRebooking,
  holdAlternativeFlight,
} from "../src/server/services/rebooking-service";
import { createSession, verifyPassenger } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario, type Fixture } from "./helpers/fixtures";

const KEY = "test-tools-api-key";

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fx = await seedScenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

const seatsOn = async (flightNumber: string) =>
  (await prisma.flight.findUnique({ where: { flightNumber } }))!.availableSeats;

async function heldSession(flightKey: "SF218" | "SF224" = "SF218") {
  const { sessionId } = await createSession();
  await verifyPassenger({ sessionId, bookingReference: "SKY82Q", lastName: "Martin" });
  await getDisruptedBooking({ sessionId });
  await searchAlternativeFlights({ sessionId });
  const hold = await holdAlternativeFlight({ sessionId, flightId: fx.flights[flightKey].id });
  return { sessionId, holdId: hold.holdId };
}

async function postCancel(body: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-api-key"] = key;
  const response = await cancelHoldRoute(
    new Request("http://localhost/api/tools/cancel-hold", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

/* ------------------------------------------------------------------ */

describe("declining a held flight", () => {
  it("releases exactly one seat and rewinds to the option list", async () => {
    const { sessionId, holdId } = await heldSession();
    expect(await seatsOn("SF218")).toBe(16);

    const result = await cancelHold({ sessionId, holdId });

    expect(result).toEqual({
      holdId,
      status: "CANCELLED",
      seatReleased: true,
      state: "OPTIONS_PRESENTED",
    });
    expect(await seatsOn("SF218")).toBe(17);

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.state).toBe("OPTIONS_PRESENTED");
    expect(session?.activeHoldId).toBeNull();

    const hold = await prisma.rebookingHold.findUnique({ where: { id: holdId } });
    expect(hold?.status).toBe("CANCELLED");

    const actions = (await prisma.auditEvent.findMany({ where: { sessionId } })).map(
      (e) => e.action,
    );
    expect(actions).toContain("HOLD_CANCELLED");
  });

  it("marks a lapsed hold as expired rather than cancelled", async () => {
    const { sessionId, holdId } = await heldSession();
    await prisma.rebookingHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const result = await cancelHold({ sessionId, holdId });

    expect(result.status).toBe("EXPIRED");
    expect(result.seatReleased).toBe(true);
    expect(await seatsOn("SF218")).toBe(17);
  });

  it("is idempotent — a retry does not return a second seat", async () => {
    const { sessionId, holdId } = await heldSession();

    const first = await cancelHold({ sessionId, holdId });
    const second = await cancelHold({ sessionId, holdId });

    expect(first.seatReleased).toBe(true);
    expect(second.seatReleased).toBe(false);
    expect(second.status).toBe("CANCELLED");
    expect(second.state).toBe("OPTIONS_PRESENTED");
    expect(await seatsOn("SF218")).toBe(17);
  });

  it("lets the passenger pick a different flight afterwards", async () => {
    const { sessionId, holdId } = await heldSession();
    await cancelHold({ sessionId, holdId });

    const second = await holdAlternativeFlight({ sessionId, flightId: fx.flights.SF224.id });
    expect(second.flightNumber).toBe("SF224");
    expect(await seatsOn("SF218")).toBe(17);
    expect(await seatsOn("SF224")).toBe(3);

    const confirmed = await confirmRebooking({
      sessionId,
      holdId: second.holdId,
      confirmed: true,
      idempotencyKey: "changed-my-mind",
    });
    expect(confirmed.newFlight.flightNumber).toBe("SF224");
  });
});

describe("refusals", () => {
  it("rejects a hold belonging to another session", async () => {
    const first = await heldSession("SF218");
    const other = await createSession();
    await verifyPassenger({
      sessionId: other.sessionId,
      bookingReference: "SKY55T",
      lastName: "Okafor",
    });

    await expectCode(
      cancelHold({ sessionId: other.sessionId, holdId: first.holdId }),
      "INVALID_STATE",
    );
    expect(await seatsOn("SF218")).toBe(16); // untouched
  });

  it("refuses to cancel a confirmed rebooking", async () => {
    const { sessionId, holdId } = await heldSession();
    await confirmRebooking({ sessionId, holdId, confirmed: true, idempotencyKey: "done-deal" });

    await expectCode(cancelHold({ sessionId, holdId }), "ALREADY_REBOOKED");
  });

  it("rejects an unknown hold", async () => {
    const { sessionId } = await heldSession();
    await expectCode(cancelHold({ sessionId, holdId: "no-such-hold" }), "INVALID_STATE");
  });
});

describe("cancel-hold endpoint", () => {
  it("needs the API key", async () => {
    const res = await postCancel({ sessionId: "s", holdId: "h" }, null);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("validates the body", async () => {
    const res = await postCancel({ sessionId: "s" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("holdId");
  });

  it("cancels over HTTP and allows a different flight to be held", async () => {
    const { sessionId, holdId } = await heldSession();

    const cancelled = await postCancel({ sessionId, holdId });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toEqual({
      holdId,
      status: "CANCELLED",
      seatReleased: true,
      state: "OPTIONS_PRESENTED",
    });

    const second = await holdAlternativeFlight({ sessionId, flightId: fx.flights.SF310.id });
    expect(second.flightNumber).toBe("SF310");
  });

  it("returns 409 when the booking is already changed", async () => {
    const { sessionId, holdId } = await heldSession();
    await confirmRebooking({ sessionId, holdId, confirmed: true, idempotencyKey: "http-done" });

    const res = await postCancel({ sessionId, holdId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_REBOOKED");
  });
});
