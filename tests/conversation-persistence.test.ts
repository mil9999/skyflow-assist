import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as chatRoute } from "../src/app/api/simulator/chat/route";
import { ConversationConflictError, createConversation, getConversation } from "../src/agent/conversation-store";
import { runTurn } from "../src/agent/conversation-runner";
import { prisma } from "../src/server/db/prisma";
import { FakeProvider, FailingProvider, textResponse, toolResponse } from "../src/server/llm/fake-provider";
import { ProviderConfigurationError, type ModelProvider, type ModelResponse } from "../src/server/llm/provider";
import { expireDueHolds } from "../src/server/services/rebooking-service";
import { createSession } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => { await resetDatabase(); await seedScenario(); });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

async function create() {
  return createConversation((await createSession("TEXT")).sessionId);
}

async function heldConversation() {
  const conversation = await create();
  await runTurn({ conversation, userMessage: "SKY82Q, Martin. Please find another flight.", model: "test", provider: new FakeProvider([
    toolResponse("verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" }),
    toolResponse("get_disrupted_booking"), toolResponse("search_alternative_flights"), textResponse("I found alternatives."),
  ]) });
  await runTurn({ conversation, userMessage: "Hold the first option.", model: "test", provider: new FakeProvider([
    toolResponse("hold_selected_flight", { optionId: conversation.latestOptions[0].optionId }),
    textResponse("I've held SF218. Do you confirm this flight?"),
  ]) });
  return conversation;
}

function worker(mode: string, id: string) {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "tests/helpers/text-recovery-worker.ts", mode, id], {
    cwd: process.cwd(), env: { ...process.env }, encoding: "utf8",
  }).trim());
}

describe("persistent completed text turns", () => {
  it("restores model history, transcript, options and a held flight in another process, then confirms once", async () => {
    const original = await heldConversation();
    expect(worker("inspect", original.conversationId)).toEqual({
      messages: original.messages, latestOptions: original.latestOptions,
      activeHoldId: original.activeHoldId, inputCount: original.input.length,
    });
    const resumed = worker("confirm", original.conversationId);
    expect(resumed).toMatchObject({ state: "REBOOKED", messageCount: 6 });
    expect(resumed.inputCount).toBeGreaterThan(original.input.length);
    expect(await prisma.idempotencyRecord.count()).toBe(1);
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: original.sessionId } })).toMatchObject({ state: "REBOOKED", activeHoldId: null });
    expect(await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).toMatchObject({ availableSeats: 16 });
    const restored = await getConversation(original.conversationId);
    expect(restored?.activeHoldId).toBeUndefined();
    expect(restored?.messages.at(-1)?.content).toBe("Rebooked.");
  });

  it("rejects overlapping and stale turns before another model request is made", async () => {
    const original = await create();
    const stale = (await getConversation(original.conversationId))!;
    let entered!: () => void;
    let answer!: (response: ModelResponse) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<ModelResponse>((resolve) => { answer = resolve; });
    const slow: ModelProvider = { name: "slow", createResponse: async () => { entered(); return pending; } };
    const first = runTurn({ conversation: original, userMessage: "Hello", provider: slow, model: "test" });
    await started;
    const otherProvider = new FakeProvider([textResponse("Should not run")]);
    try {
      await expect(runTurn({ conversation: stale, userMessage: "Another request", provider: otherProvider, model: "test" })).rejects.toBeInstanceOf(ConversationConflictError);
    } finally {
      answer(textResponse("Hello back"));
      await first;
    }
    await expect(runTurn({ conversation: stale, userMessage: "Stale request", provider: otherProvider, model: "test" })).rejects.toBeInstanceOf(ConversationConflictError);
    expect(otherProvider.requests).toHaveLength(0);
    expect((await getConversation(original.conversationId))?.messages).toHaveLength(2);
  });

  it("keeps an interrupted process locked and returns a recoverable HTTP conflict without running tools", async () => {
    vi.stubEnv("TEXT_AGENT_PROVIDER", "fake");
    const original = await create();
    expect(worker("interrupt", original.conversationId)).toEqual({ interrupted: true });
    const response = await chatRoute(new Request("http://localhost/api/simulator/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: original.conversationId, message: "Confirm" }),
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("interrupted");
    expect((await getConversation(original.conversationId))?.messages).toEqual([]);
    expect(await prisma.rebookingHold.count()).toBe(0);
    expect(await create()).toBeDefined();
  });

  it("uses the authoritative hold state when an expiry worker changed a saved conversation", async () => {
    const original = await heldConversation();
    await prisma.rebookingHold.update({ where: { id: original.activeHoldId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expireDueHolds();
    const restored = (await getConversation(original.conversationId))!;
    expect(restored.activeHoldId).toBeUndefined();
    const result = await runTurn({ conversation: restored, userMessage: "Yes", model: "test", provider: new FakeProvider([
      toolResponse("confirm_flight_rebooking", { confirmed: true }), textResponse("That hold expired. Let's search again."),
    ]) });
    expect(result.trace.find((step) => step.type === "TOOL")?.errorCode).toBe("INVALID_STATE");
    expect(await prisma.idempotencyRecord.count()).toBe(0);
    expect(await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).toMatchObject({ availableSeats: 17 });
  });

  it("saves handled provider configuration failures without leaving the conversation locked", async () => {
    const conversation = await create();
    const result = await runTurn({ conversation, userMessage: "Hello", model: "test", provider: new FailingProvider(new ProviderConfigurationError("Missing test configuration")) });
    expect(result.stopReason).toBe("PROVIDER_CONFIGURATION");
    const restored = (await getConversation(conversation.conversationId))!;
    const retry = await runTurn({ conversation: restored, userMessage: "Hello again", model: "test", provider: new FakeProvider([textResponse("Hello")]) });
    expect(retry.stopReason).toBe("COMPLETED");
    expect((await getConversation(conversation.conversationId))?.messages).toHaveLength(3);
  });

  it("cascades deleted demo sessions to their checkpoints so reset cannot resurrect history", async () => {
    const conversation = await create();
    await resetDatabase();
    expect(await getConversation(conversation.conversationId)).toBeUndefined();
    expect(await prisma.textConversation.count()).toBe(0);
  });
});
