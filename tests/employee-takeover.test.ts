import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as holdRoute } from "../src/app/api/tools/hold-flight/route";
import { GET as queueRoute } from "../src/app/api/employee/sessions/route";
import { POST as actionRoute } from "../src/app/api/employee/sessions/[id]/actions/route";
import { GET as passengerRoute } from "../src/app/api/conversations/[id]/route";
import { POST as passengerMessage } from "../src/app/api/conversations/[id]/messages/route";
import { createConversation } from "../src/agent/conversation-store";
import { runTurn } from "../src/agent/conversation-runner";
import { executeTool } from "../src/agent/tool-executor";
import { prisma } from "../src/server/db/prisma";
import { employeeAction, employeeDetail, takeOver } from "../src/server/employee/service";
import { FakeProvider, textResponse, toolResponse } from "../src/server/llm/fake-provider";
import type { ModelProvider, ModelResponse } from "../src/server/llm/provider";
import { confirmRebooking, expireDueHolds } from "../src/server/services/rebooking-service";
import { escalateSession } from "../src/server/services/escalation-service";
import { createSession, verifyPassenger } from "../src/server/services/verification-service";
import { startHoldExpiryWorker, holdExpiryWorkerStatus } from "../src/server/services/hold-expiry-worker";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => { vi.stubEnv("NODE_ENV", "development"); await resetDatabase(); await seedScenario(); });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body?: unknown, url = "http://localhost:3000/api/test") => new Request(url, { method: body ? "POST" : "GET", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
async function create() { return createConversation((await createSession()).sessionId); }
async function held() {
  const conversation = await create();
  await runTurn({ conversation, userMessage: "SKY82Q, Martin. Find a flight.", provider: new FakeProvider([
    toolResponse("verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" }), toolResponse("get_disrupted_booking"), toolResponse("search_alternative_flights"), textResponse("I found flights."),
  ]), model: "test" });
  await runTurn({ conversation, userMessage: "Hold the first.", provider: new FakeProvider([toolResponse("hold_selected_flight", { optionId: "option_1" }), textResponse("SF218 held. Do you confirm?")]), model: "test" });
  return conversation;
}

describe("employee control", () => {
  it("retains a held seat, rejects AI tools and spoofed roles, and requires explicit employee confirmation", async () => {
    const conversation = await held();
    await takeOver(conversation.sessionId);
    expect(await executeTool(conversation, "confirm_flight_rebooking", '{"confirmed":true}')).toMatchObject({ ok: false, code: "SESSION_TAKEN_OVER" });
    await expect(confirmRebooking({ sessionId: conversation.sessionId, holdId: conversation.activeHoldId!, confirmed: true, idempotencyKey: "delayed-ai-confirm" })).rejects.toMatchObject({ code: "SESSION_TAKEN_OVER" });
    const spoofed = await holdRoute(new Request("http://internal/api/tools/hold-flight", { method: "POST", headers: { "x-api-key": process.env.TOOLS_API_KEY!, "content-type": "application/json" }, body: JSON.stringify({ sessionId: conversation.sessionId, flightId: conversation.latestOptions[1].flightId, actor: "EMPLOYEE" }) }));
    expect(spoofed.status).toBe(409);
    expect((await spoofed.json()).code).toBe("SESSION_TAKEN_OVER");
    await expect(employeeAction(conversation.sessionId, { action: "confirm", holdId: conversation.activeHoldId!, confirmed: false })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(await prisma.booking.findUniqueOrThrow({ where: { bookingReference: "SKY82Q" } })).toMatchObject({ status: "DISRUPTED" });
    await employeeAction(conversation.sessionId, { action: "confirm", holdId: conversation.activeHoldId!, confirmed: true });
    expect(await prisma.booking.findUniqueOrThrow({ where: { bookingReference: "SKY82Q" } })).toMatchObject({ status: "REBOOKED" });
    expect(await prisma.auditEvent.count({ where: { action: "REBOOKING_CONFIRMED" } })).toBe(1);
  });

  it("does not allow employee actions until takeover and keeps repeated takeover idempotent", async () => {
    const conversation = await create();
    await expect(employeeAction(conversation.sessionId, { action: "search" })).rejects.toMatchObject({ code: "TAKEOVER_REQUIRED" });
    await takeOver(conversation.sessionId); await takeOver(conversation.sessionId);
    expect(await prisma.auditEvent.count({ where: { action: "EMPLOYEE_TAKEOVER" } })).toBe(1);
    expect(await prisma.conversationEntry.count({ where: { role: "SYSTEM" } })).toBe(1);
  });

  it("refuses an old employee approval after another window replaces the held flight", async () => {
    const conversation = await held();
    await takeOver(conversation.sessionId);
    const oldHoldId = conversation.activeHoldId!;
    await employeeAction(conversation.sessionId, { action: "release" });
    const replacement = await employeeAction(conversation.sessionId, { action: "hold", flightId: conversation.latestOptions[1].flightId }) as { holdId: string };
    await expect(employeeAction(conversation.sessionId, { action: "confirm", holdId: oldHoldId, confirmed: true })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await prisma.booking.findUniqueOrThrow({ where: { bookingReference: "SKY82Q" } })).toMatchObject({ status: "DISRUPTED" });
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } })).toMatchObject({ activeHoldId: replacement.holdId });
    await employeeAction(conversation.sessionId, { action: "confirm", holdId: replacement.holdId, confirmed: true });
    expect((await employeeDetail(conversation.sessionId))?.booking?.flight).toBe("SF224");
  });

  it("retains older text history when takeover adds the first shared transcript entry", async () => {
    const conversation = await held();
    await prisma.conversationEntry.deleteMany({ where: { sessionId: conversation.sessionId } });
    await takeOver(conversation.sessionId);
    const messages = (await employeeDetail(conversation.sessionId))!.messages;
    expect(messages.map((entry) => entry.content)).toContain("I found flights.");
    expect(messages.at(-1)?.role).toBe("SYSTEM");
  });

  it("suppresses an in-flight AI reply after takeover and saves the passenger's message", async () => {
    const conversation = await create();
    let entered!: () => void; let answer!: (response: ModelResponse) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<ModelResponse>((resolve) => { answer = resolve; });
    const provider: ModelProvider = { name: "slow", createResponse: async () => { entered(); return pending; } };
    const turn = runTurn({ conversation, userMessage: "I need a person", provider, model: "test" });
    await started;
    await takeOver(conversation.sessionId);
    answer(textResponse("Your booking is changed"));
    expect(await turn).toMatchObject({ stopReason: "EMPLOYEE_TAKEOVER", assistantMessage: "" });
    const detail = await employeeDetail(conversation.sessionId);
    expect(detail?.messages.some((entry) => entry.content === "I need a person")).toBe(true);
    expect(detail?.messages.some((entry) => entry.content === "Your booking is changed")).toBe(false);
  });

  it("requires identity again after failed-verification escalation and lets staff finish a verified review", async () => {
    const conversation = await create();
    for (let i = 0; i < 2; i++) await expect(verifyPassenger({ sessionId: conversation.sessionId, bookingReference: "SKY82Q", lastName: "Wrong" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await takeOver(conversation.sessionId);
    expect((await employeeDetail(conversation.sessionId))?.booking).toBeNull();
    await expect(employeeAction(conversation.sessionId, { action: "load" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await employeeAction(conversation.sessionId, { action: "verify", bookingReference: "SKY82Q", lastName: "Martin" });
    await employeeAction(conversation.sessionId, { action: "load" });
    const result = await employeeAction(conversation.sessionId, { action: "search" }) as { options: { flightId: string }[] };
    const hold = await employeeAction(conversation.sessionId, { action: "hold", flightId: result.options[0].flightId }) as { holdId: string };
    await employeeAction(conversation.sessionId, { action: "confirm", holdId: hold.holdId, confirmed: true });
    await employeeAction(conversation.sessionId, { action: "resolve" });
    expect(await prisma.supportCase.count({ where: { status: "OPEN" } })).toBe(0);
    expect((await employeeDetail(conversation.sessionId))?.booking?.status).toBe("REBOOKED");
  });

  it("releases a direct webhook escalation hold atomically instead of stranding inventory", async () => {
    const conversation = await held();
    await escalateSession({ sessionId: conversation.sessionId, reason: "PASSENGER_REQUEST" });
    expect(await prisma.rebookingHold.findUniqueOrThrow({ where: { id: conversation.activeHoldId } })).toMatchObject({ status: "CANCELLED" });
    expect(await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).toMatchObject({ availableSeats: 17 });
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } })).toMatchObject({ state: "ESCALATED", activeHoldId: null });
  });

  it("delivers human messages both ways without invoking AI and rejects forged employee roles", async () => {
    const conversation = await create(); await takeOver(conversation.sessionId);
    await employeeAction(conversation.sessionId, { action: "message", messageId: "staff-1", content: "Which flight would you prefer?" });
    await employeeAction(conversation.sessionId, { action: "message", messageId: "staff-1", content: "Which flight would you prefer?" });
    const sent = await passengerMessage(request({ content: "The first flight, please.", messageId: "user-1" }), context(conversation.conversationId));
    expect(sent.status).toBe(200);
    const forged = await passengerMessage(request({ content: "Approved", messageId: "user-2", role: "EMPLOYEE" }), context(conversation.conversationId));
    expect(forged.status).toBe(400);
    const response = await passengerRoute(request(), context(conversation.conversationId));
    const body = await response.json();
    expect(body.messages.map((entry: { role: string }) => entry.role)).toEqual(["SYSTEM", "EMPLOYEE", "USER"]);
    expect(JSON.stringify(body)).not.toMatch(/sessionId|holdId|flightId|idempotencyKey|snapshot/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await prisma.auditEvent.count({ where: { action: "EMPLOYEE_MESSAGE_SENT" } })).toBe(1);
  });

  it("refuses cross-site, non-local and production employee access before any mutation", async () => {
    const conversation = await create();
    expect((await actionRoute(new Request("http://localhost:3000/api/employee", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ action: "takeover" }) }), context(conversation.sessionId))).status).toBe(403);
    expect((await queueRoute(new Request("https://example.com/api/employee/sessions"))).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await queueRoute(request())).status).toBe(403);
    expect((await actionRoute(request({ action: "takeover" }), context(conversation.sessionId))).status).toBe(403);
    expect((await passengerRoute(request(), context(conversation.conversationId))).status).toBe(403);
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } })).toMatchObject({ controller: "AI" });
  });

  it("recovers overdue employee-owned holds on local worker startup", async () => {
    const conversation = await held(); await takeOver(conversation.sessionId);
    await prisma.rebookingHold.update({ where: { id: conversation.activeHoldId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const worker = startHoldExpiryWorker();
    try {
      expect(await worker.ready).toBe(1);
      expect(holdExpiryWorkerStatus()).toMatchObject({ running: true, failed: false });
      expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } })).toMatchObject({ controller: "EMPLOYEE", state: "OPTIONS_PRESENTED", activeHoldId: null });
      expect(await expireDueHolds()).toEqual([]);
    } finally { worker.stop(); }
    expect(holdExpiryWorkerStatus().running).toBe(false);
  });
});
