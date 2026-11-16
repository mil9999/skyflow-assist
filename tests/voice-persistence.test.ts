import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as transcript } from "../src/app/api/voice/transcript/route";
import { prisma } from "../src/server/db/prisma";
import { takeOver, employeeDetail, employeeAction } from "../src/server/employee/service";
import { createSession } from "../src/server/services/verification-service";
import { clearVoiceSessions, createVoiceSession, endVoiceSession, runVoiceTool } from "../src/server/voice/sessions";
import { resetDatabase, seedScenario } from "./helpers/fixtures";
beforeEach(async () => { vi.stubEnv("NODE_ENV", "development"); clearVoiceSessions(); await resetDatabase(); await seedScenario(); });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());
async function create() { const { sessionId } = await createSession("VOICE"); return { id: await createVoiceSession(sessionId), sessionId }; }
const call = (id: string, name: string, args = {}, callId = crypto.randomUUID()) => runVoiceTool(id, callId, name, args);
function worker(id: string, callId: string, name: string, args = {}) { return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "tests/helpers/voice-recovery-worker.ts", "tool", id, callId, name, JSON.stringify(args)], { cwd: process.cwd(), env: { ...process.env }, encoding: "utf8" }).trim()); }
async function held() { const opened = await create(); await call(opened.id, "verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" }); await call(opened.id, "get_disrupted_booking"); await call(opened.id, "search_alternative_flights"); await call(opened.id, "hold_selected_flight", { optionId: "option_1" }); return opened; }
function message(body: unknown) { return transcript(new Request("http://localhost:3000/api/voice/transcript", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) })); }
describe("persisted voice bridge", () => {
  it("restores option mappings and a held seat in another process, then confirms once", async () => {
    const opened = await held();
    const confirmed = worker(opened.id, "confirm", "confirm_flight_rebooking", { confirmed: true });
    expect(confirmed).toMatchObject({ state: "REBOOKED", holdActive: false });
    expect(worker(opened.id, "confirm", "confirm_flight_rebooking", { confirmed: true })).toEqual(confirmed);
    expect(await prisma.auditEvent.count({ where: { action: "REBOOKING_CONFIRMED" } })).toBe(1);
    await endVoiceSession(opened.id);
    expect(await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).toMatchObject({ availableSeats: 16 });
  });
  it("deduplicates failed verification across processes without consuming another attempt", async () => {
    const opened = await create(); const args = { bookingReference: "SKY82Q", lastName: "Wrong" };
    const first = await call(opened.id, "verify_passenger_identity", args, "verify-once");
    clearVoiceSessions();
    expect(worker(opened.id, "verify-once", "verify_passenger_identity", args)).toEqual(first);
    expect(await prisma.auditEvent.count({ where: { action: "VERIFICATION_FAILED" } })).toBe(1);
    expect(worker(opened.id, "verify-once", "get_disrupted_booking")).toEqual({ error: 409 });
  });
  it("persists closed state and refuses interrupted operations without re-running tools", async () => {
    const opened = await create(); await endVoiceSession(opened.id); clearVoiceSessions();
    expect(worker(opened.id, "late", "verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" })).toEqual({ error: 410 });
    const other = await create();
    await prisma.voiceConversation.update({ where: { id: other.id }, data: { busy: true } });
    expect(worker(other.id, "pending", "verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" })).toEqual({ error: 409 });
    expect(await prisma.auditEvent.count({ where: { action: "PASSENGER_VERIFIED" } })).toBe(0);
  });
  it("keeps an employee-owned seat when the AI transport disconnects and blocks even cached tools", async () => {
    const opened = await held(); await takeOver(opened.sessionId);
    await endVoiceSession(opened.id);
    const refused = await call(opened.id, "confirm_flight_rebooking", { confirmed: true });
    expect(refused.result).toMatchObject({ ok: false, code: "SESSION_TAKEN_OVER" });
    expect(await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).toMatchObject({ availableSeats: 16 });
    const holdId = (await employeeDetail(opened.sessionId))!.hold!.id;
    await employeeAction(opened.sessionId, { action: "confirm", holdId, confirmed: true });
    expect((await employeeDetail(opened.sessionId))?.booking?.status).toBe("REBOOKED");
  });
  it("stores transcript updates once, separates speaker roles, and ignores late AI text after takeover", async () => {
    const opened = await create();
    const body = { conversationId: opened.id, messageId: "utterance-1", role: "user", content: "My flight" };
    expect((await message(body)).status).toBe(200);
    expect((await message({ ...body, content: "My flight was cancelled" })).status).toBe(200);
    expect(await prisma.conversationEntry.count()).toBe(1);
    expect((await message({ ...body, role: "agent" })).status).toBe(409);
    await takeOver(opened.sessionId);
    expect((await message({ ...body, messageId: "late-agent", role: "agent", content: "An old AI reply" })).status).toBe(200);
    const detail = await employeeDetail(opened.sessionId);
    expect(detail?.messages.some((entry) => entry.content === "My flight was cancelled")).toBe(true);
    expect(detail?.messages.some((entry) => entry.content === "An old AI reply")).toBe(false);
  });
});
