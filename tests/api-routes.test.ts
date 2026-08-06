import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db/prisma";
import { POST as confirmRebookingRoute } from "../src/app/api/tools/confirm-rebooking/route";
import { POST as escalateRoute } from "../src/app/api/tools/escalate/route";
import { POST as getBookingRoute } from "../src/app/api/tools/get-booking/route";
import { POST as holdFlightRoute } from "../src/app/api/tools/hold-flight/route";
import { POST as searchFlightsRoute } from "../src/app/api/tools/search-flights/route";
import { POST as startSessionRoute } from "../src/app/api/tools/start-session/route";
import { POST as verifyPassengerRoute } from "../src/app/api/tools/verify-passenger/route";
import { resetDatabase, seedScenario, type Fixture } from "./helpers/fixtures";

type Route = (request: Request) => Promise<Response>;

const KEY = "test-tools-api-key";

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  fx = await seedScenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function request(body: unknown, key: string | null = KEY, raw?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-api-key"] = key;
  return new Request("http://localhost/api/tools/test", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(body),
  });
}

async function post(route: Route, body: unknown, key: string | null = KEY) {
  const response = await route(request(body, key));
  return { status: response.status, body: await response.json() };
}

/** Drives the whole flow through HTTP and hands back the ids it collected. */
async function runFlowToHold() {
  const start = await post(startSessionRoute, {});
  const sessionId = start.body.data.sessionId as string;

  await post(verifyPassengerRoute, { sessionId, bookingReference: "SKY82Q", lastName: "Martin" });
  await post(getBookingRoute, { sessionId });
  await post(searchFlightsRoute, { sessionId });

  const hold = await post(holdFlightRoute, { sessionId, flightId: fx.flights.SF218.id });
  return { sessionId, holdId: hold.body.data.holdId as string };
}

/* ------------------------------------------------------------------ */

describe("authentication", () => {
  it("rejects a request with no key", async () => {
    const res = await post(startSessionRoute, {}, null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, code: "UNAUTHORIZED", message: "Not authorised." });
  });

  it("rejects a wrong key", async () => {
    const res = await post(startSessionRoute, {}, "not-the-key");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects a key of a different length without leaking that fact", async () => {
    const short = await post(startSessionRoute, {}, "x");
    const long = await post(startSessionRoute, {}, "x".repeat(500));
    expect(short.body).toEqual(long.body);
  });

  it("fails closed when the server key is not configured", async () => {
    const saved = process.env.TOOLS_API_KEY;
    delete process.env.TOOLS_API_KEY;
    try {
      const res = await post(startSessionRoute, {}, KEY);
      expect(res.status).toBe(401);
    } finally {
      process.env.TOOLS_API_KEY = saved;
    }
  });
});

describe("validation", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await startSessionRoute(request(null, KEY, "{not json"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("BAD_REQUEST");
  });

  it("rejects a missing sessionId", async () => {
    const res = await post(getBookingRoute, {});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("sessionId");
  });

  it("rejects a non-boolean confirmation", async () => {
    const res = await post(confirmRebookingRoute, {
      sessionId: "s",
      holdId: "h",
      confirmed: "yes",
      idempotencyKey: "12345678",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown escalation reason", async () => {
    const res = await post(escalateRoute, { sessionId: "s", reason: "BECAUSE" });
    expect(res.status).toBe(400);
  });
});

describe("happy path over HTTP", () => {
  it("carries a passenger from session to confirmed rebooking", async () => {
    const start = await post(startSessionRoute, { channel: "VOICE" });
    expect(start.status).toBe(200);
    expect(start.body.ok).toBe(true);
    const sessionId = start.body.data.sessionId as string;

    const verified = await post(verifyPassengerRoute, {
      sessionId,
      bookingReference: "sky 82 q",
      lastName: "martin",
    });
    expect(verified.status).toBe(200);
    expect(verified.body.data).toEqual({ verified: true, sessionId, bookingReference: "SKY82Q" });

    const booking = await post(getBookingRoute, { sessionId });
    expect(booking.status).toBe(200);
    expect(booking.body.data.flight.flightNumber).toBe("SF204");

    const search = await post(searchFlightsRoute, { sessionId });
    expect(search.status).toBe(200);
    expect(search.body.data.options.map((o: { flightNumber: string }) => o.flightNumber)).toEqual([
      "SF218",
      "SF224",
      "SF310",
    ]);

    const hold = await post(holdFlightRoute, { sessionId, flightId: fx.flights.SF218.id });
    expect(hold.status).toBe(200);
    expect(hold.body.data.requiresConfirmation).toBe(true);

    const confirmed = await post(confirmRebookingRoute, {
      sessionId,
      holdId: hold.body.data.holdId,
      confirmed: true,
      idempotencyKey: "http-happy-path-1",
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.newFlight.flightNumber).toBe("SF218");

    const stored = await prisma.booking.findUnique({ where: { bookingReference: "SKY82Q" } });
    expect(stored?.status).toBe("REBOOKED");
  });

  it("accepts search preferences", async () => {
    const start = await post(startSessionRoute, {});
    const sessionId = start.body.data.sessionId as string;
    await post(verifyPassengerRoute, { sessionId, bookingReference: "SKY82Q", lastName: "Martin" });
    await post(getBookingRoute, { sessionId });

    const direct = await post(searchFlightsRoute, { sessionId, directOnly: true });
    expect(direct.body.data.options.map((o: { flightNumber: string }) => o.flightNumber)).toEqual([
      "SF218",
      "SF224",
    ]);

    const early = await post(searchFlightsRoute, {
      sessionId,
      latestArrivalTime: fx.at(400).toISOString(),
    });
    expect(early.body.data.options).toHaveLength(1);
  });
});

describe("domain errors map to statuses", () => {
  it("401 for bad credentials, identical whichever half was wrong", async () => {
    // Separate sessions: two failures on one session would trigger escalation.
    const first = await post(startSessionRoute, {});
    const wrongSurname = await post(verifyPassengerRoute, {
      sessionId: first.body.data.sessionId,
      bookingReference: "SKY82Q",
      lastName: "Dubois",
    });

    const second = await post(startSessionRoute, {});
    const wrongReference = await post(verifyPassengerRoute, {
      sessionId: second.body.data.sessionId,
      bookingReference: "SKY000",
      lastName: "Martin",
    });

    expect(wrongSurname.status).toBe(401);
    expect(wrongSurname.body.code).toBe("INVALID_CREDENTIALS");
    // Byte-identical, so probing cannot reveal which half was correct.
    expect(wrongReference.status).toBe(wrongSurname.status);
    expect(wrongReference.body).toEqual(wrongSurname.body);
  });

  it("409 for asking out of order", async () => {
    const start = await post(startSessionRoute, {});
    const res = await post(getBookingRoute, { sessionId: start.body.data.sessionId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_STATE");
  });

  it("409 when no alternatives exist", async () => {
    const start = await post(startSessionRoute, {});
    const sessionId = start.body.data.sessionId as string;
    await post(verifyPassengerRoute, { sessionId, bookingReference: "SKY55T", lastName: "Okafor" });
    await post(getBookingRoute, { sessionId });

    const res = await post(searchFlightsRoute, { sessionId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_ALTERNATIVES");
  });

  it("409 when the seat goes before the hold lands", async () => {
    const start = await post(startSessionRoute, {});
    const sessionId = start.body.data.sessionId as string;
    await post(verifyPassengerRoute, { sessionId, bookingReference: "SKY82Q", lastName: "Martin" });
    await post(getBookingRoute, { sessionId });
    await post(searchFlightsRoute, { sessionId });

    await prisma.flight.update({ where: { flightNumber: "SF218" }, data: { availableSeats: 0 } });

    const res = await post(holdFlightRoute, { sessionId, flightId: fx.flights.SF218.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FLIGHT_UNAVAILABLE");
  });

  it("422 when the passenger has not said yes", async () => {
    const { sessionId, holdId } = await runFlowToHold();
    const res = await post(confirmRebookingRoute, {
      sessionId,
      holdId,
      confirmed: false,
      idempotencyKey: "http-not-confirmed",
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("410 when the hold has expired", async () => {
    const { sessionId, holdId } = await runFlowToHold();
    await prisma.rebookingHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await post(confirmRebookingRoute, {
      sessionId,
      holdId,
      confirmed: true,
      idempotencyKey: "http-expired",
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("HOLD_EXPIRED");
  });

  it("409 on a second rebooking under a fresh key", async () => {
    const { sessionId, holdId } = await runFlowToHold();
    await post(confirmRebookingRoute, {
      sessionId,
      holdId,
      confirmed: true,
      idempotencyKey: "http-first-key",
    });

    const res = await post(confirmRebookingRoute, {
      sessionId,
      holdId,
      confirmed: true,
      idempotencyKey: "http-second-key",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_REBOOKED");
  });

  it("replays an identical confirmation without rebooking twice", async () => {
    const { sessionId, holdId } = await runFlowToHold();
    const args = { sessionId, holdId, confirmed: true, idempotencyKey: "http-replay" };

    const first = await post(confirmRebookingRoute, args);
    const second = await post(confirmRebookingRoute, args);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
  });
});

describe("escalation", () => {
  it("hands the conversation to a human", async () => {
    const start = await post(startSessionRoute, {});
    const res = await post(escalateRoute, {
      sessionId: start.body.data.sessionId,
      reason: "PASSENGER_REQUEST",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.escalatedFromState).toBe("UNVERIFIED");
    expect(res.body.data.reference).toBeTruthy();
  });
});
