import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createConversation, clearConversations } from "../src/agent/conversation-store";
import { executeTool } from "../src/agent/tool-executor";
import type { SimulatorConversation } from "../src/agent/types";
import { prisma } from "../src/server/db/prisma";
import { createSession } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario, type Fixture } from "./helpers/fixtures";

let fx: Fixture;

beforeEach(async () => {
  clearConversations();
  await resetDatabase();
  fx = await seedScenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newConversation(): Promise<SimulatorConversation> {
  const { sessionId } = await createSession("TEXT");
  return createConversation(sessionId);
}

const call = (conversation: SimulatorConversation, name: string, args: unknown = {}) =>
  executeTool(conversation, name, JSON.stringify(args));

async function verifiedConversation() {
  const conversation = await newConversation();
  await call(conversation, "verify_passenger_identity", {
    bookingReference: "SKY82Q",
    lastName: "Martin",
  });
  await call(conversation, "get_disrupted_booking");
  return conversation;
}

/* ------------------------------------------------------------------ */

describe("identifier injection", () => {
  it("supplies the sessionId the model never sees", async () => {
    const conversation = await newConversation();

    const result = await call(conversation, "verify_passenger_identity", {
      bookingReference: "SKY82Q",
      lastName: "Martin",
    });

    expect(result.ok).toBe(true);
    const session = await prisma.conversationSession.findUnique({
      where: { id: conversation.sessionId },
    });
    expect(session?.state).toBe("VERIFIED");
  });

  it("keeps real flight IDs out of the model's view", async () => {
    const conversation = await verifiedConversation();

    const result = await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });

    const payload = result.payload as { options: Record<string, unknown>[] };
    expect(payload.options).toHaveLength(3);
    expect(payload.options[0]).not.toHaveProperty("flightId");
    expect(JSON.stringify(payload)).not.toContain(fx.flights.SF218.id);

    // But the server kept them.
    expect(conversation.latestOptions[0].flightId).toBe(fx.flights.SF218.id);
  });

  it("maps an optionId back to the real flight", async () => {
    const conversation = await verifiedConversation();
    await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });

    const result = await call(conversation, "hold_selected_flight", { optionId: "option_1" });

    expect(result.ok).toBe(true);
    expect((result.payload as { flightNumber: string }).flightNumber).toBe("SF218");
    expect(conversation.activeHoldId).toBeTruthy();
  });

  it("refuses an optionId it never issued", async () => {
    const conversation = await verifiedConversation();
    await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });

    const result = await call(conversation, "hold_selected_flight", { optionId: "option_9" });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("FLIGHT_UNAVAILABLE");
  });
});

describe("confirmation safety", () => {
  async function heldConversation() {
    const conversation = await verifiedConversation();
    await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });
    await call(conversation, "hold_selected_flight", { optionId: "option_1" });
    return conversation;
  }

  it("refuses to confirm when nothing is held", async () => {
    const conversation = await verifiedConversation();
    const result = await call(conversation, "confirm_flight_rebooking", { confirmed: true });

    expect(result.code).toBe("INVALID_STATE");
  });

  it("refuses confirmed: false without reaching the airline", async () => {
    const conversation = await heldConversation();
    const result = await call(conversation, "confirm_flight_rebooking", { confirmed: false });

    expect(result.status).toBe(422);
    expect(result.code).toBe("CONFIRMATION_REQUIRED");

    const booking = await prisma.booking.findUnique({ where: { bookingReference: "SKY82Q" } });
    expect(booking?.status).toBe("DISRUPTED");
  });

  it("generates a stable idempotency key the model cannot influence", async () => {
    const conversation = await heldConversation();
    await call(conversation, "confirm_flight_rebooking", { confirmed: true });

    expect(conversation.confirmationIdempotencyKey).toMatch(
      new RegExp(`^simulator:${conversation.conversationId}:confirm:.+$`),
    );

    const record = await prisma.idempotencyRecord.findFirst();
    expect(record?.key).toBe(conversation.confirmationIdempotencyKey);
  });

  it("issues a fresh key after a different flight is held", async () => {
    const conversation = await heldConversation();
    const firstHold = conversation.activeHoldId;

    await call(conversation, "release_held_flight");
    await call(conversation, "hold_selected_flight", { optionId: "option_2" });

    expect(conversation.activeHoldId).not.toBe(firstHold);
    expect(conversation.confirmationIdempotencyKey).toBeUndefined();
  });
});

describe("releasing", () => {
  it("needs a held seat", async () => {
    const conversation = await verifiedConversation();
    const result = await call(conversation, "release_held_flight");

    expect(result.code).toBe("INVALID_STATE");
  });

  it("gives the seat back and clears server state", async () => {
    const conversation = await verifiedConversation();
    await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });
    await call(conversation, "hold_selected_flight", { optionId: "option_1" });

    const before = await prisma.flight.findUnique({ where: { flightNumber: "SF218" } });
    expect(before?.availableSeats).toBe(16);

    const result = await call(conversation, "release_held_flight");

    expect(result.ok).toBe(true);
    expect(conversation.activeHoldId).toBeUndefined();
    const after = await prisma.flight.findUnique({ where: { flightNumber: "SF218" } });
    expect(after?.availableSeats).toBe(17);
  });
});

describe("terminal sessions", () => {
  it("refuses every tool once the booking is rebooked", async () => {
    const conversation = await verifiedConversation();
    await call(conversation, "search_alternative_flights", {
      directOnly: null,
      latestArrivalTime: null,
    });
    await call(conversation, "hold_selected_flight", { optionId: "option_1" });
    await call(conversation, "confirm_flight_rebooking", { confirmed: true });

    for (const tool of [
      "search_alternative_flights",
      "hold_selected_flight",
      "confirm_flight_rebooking",
      "transfer_to_human_agent",
    ]) {
      const result = await call(conversation, tool, { optionId: "option_1", confirmed: true });
      expect(result.code).toBe("INVALID_STATE");
    }
  });
});

describe("bad input", () => {
  it("rejects an unknown tool name", async () => {
    const conversation = await newConversation();
    const result = await call(conversation, "delete_everything");
    expect(result.code).toBe("BAD_REQUEST");
  });

  it("rejects unparseable arguments", async () => {
    const conversation = await newConversation();
    const result = await executeTool(conversation, "verify_passenger_identity", "{not json");
    expect(result.code).toBe("BAD_REQUEST");
  });
});
