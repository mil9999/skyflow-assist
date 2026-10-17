import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as start } from "../src/app/api/voice/sessions/route";
import { GET as status } from "../src/app/api/voice/status/route";
import { POST as tool } from "../src/app/api/voice/tools/route";
import { POST as end } from "../src/app/api/voice/end/route";
import { prisma } from "../src/server/db/prisma";
import { clearVoiceSessions } from "../src/server/voice/sessions";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

const testKey = "elevenlabs-test-credential";
const signedUrl = "wss://api.elevenlabs.io/v1/convai/conversation?test_token=fixture";
const request = (path: string, body?: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/voice/${path}`, {
  method: "POST", headers: { "content-type": "application/json", origin }, body: body ? JSON.stringify(body) : undefined,
});
const call = async (conversationId: string, name: string, args: Record<string, unknown> = {}, callId: string = randomUUID()) => {
  const response = await tool(request("tools", { conversationId, callId, name, args }));
  return { response, body: await response.json() };
};
const open = async () => {
  const response = await start(request("sessions"));
  expect(response.status).toBe(200);
  return response.json();
};
const hold = async (id: string) => {
  await call(id, "verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" });
  await call(id, "get_disrupted_booking");
  await call(id, "search_alternative_flights");
  const held = await call(id, "hold_selected_flight", { optionId: "option_1" });
  expect(held.body.result.ok).toBe(true);
};

beforeEach(async () => {
  clearVoiceSessions();
  await resetDatabase();
  await seedScenario();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ELEVENLABS_API_KEY", testKey);
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_test_skyflow");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: signedUrl })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => prisma.$disconnect());

describe("local ElevenLabs bridge", () => {
  it("reports configuration without exposing either value", async () => {
    const response = await status(new Request("http://localhost:3000/api/voice/status"));
    expect(await response.json()).toEqual({ ok: true, apiKeyConfigured: true, agentConfigured: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("obtains a signed URL with the server key and opens a VOICE session", async () => {
    const data = await open();
    expect(data.signedUrl).toBe(signedUrl);
    expect(data.conversationId).toMatch(/^voice_/);
    expect(JSON.stringify(data)).not.toContain(testKey);
    expect(data).not.toHaveProperty("sessionId");
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { "xi-api-key": testKey } }));
    expect(await prisma.conversationSession.findFirstOrThrow()).toMatchObject({ channel: "VOICE", state: "UNVERIFIED" });
  });

  it("fails closed in production without requesting a billable provider session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await start(request("sessions"))).status).toBe(403);
    expect((await tool(request("tools", {}))).status).toBe(403);
    expect((await end(request("end", {}))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.conversationSession.count()).toBe(0);
  });

  it("rejects remote hosts and a foreign browser origin", async () => {
    expect((await start(new Request("https://example.com/api/voice/sessions", { method: "POST" }))).status).toBe(403);
    expect((await start(request("sessions", undefined, "https://example.com"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks the browser's Host when Next reconstructs the URL from its bind address", async () => {
    const response = await status(new Request("http://localhost:3000/api/voice/status", {
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    }));
    expect(response.status).toBe(200);
    expect((await status(new Request("http://localhost:3000/api/voice/status", {
      headers: { host: "example.com", origin: "http://example.com" },
    }))).status).toBe(403);
  });

  it("requires both local credentials before making an upstream request", async () => {
    vi.stubEnv("ELEVENLABS_AGENT_ID", "");
    const response = await start(request("sessions"));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.conversationSession.count()).toBe(0);
  });

  it("does not forward sensitive upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: testKey }, { status: 401 })));
    const response = await start(request("sessions"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(testKey);
    expect(await prisma.conversationSession.count()).toBe(0);
  });

  it("rejects a malformed or insecure provider URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signed_url: "https://example.com/?secret=fixture" })));
    expect((await start(request("sessions"))).status).toBe(503);
    expect(await prisma.conversationSession.count()).toBe(0);
  });

  it("refuses booking disclosure before verification and ignores invented internal IDs", async () => {
    const { conversationId } = await open();
    const { body } = await call(conversationId, "get_disrupted_booking", { sessionId: "invented" });
    expect(body.result).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(JSON.stringify(body)).not.toContain("SF204");
    expect(await prisma.auditEvent.count({ where: { action: "BOOKING_RETRIEVED" } })).toBe(0);
  });

  it("serializes overlapping tool calls for one passenger", async () => {
    const { conversationId } = await open();
    const results = await Promise.all([
      call(conversationId, "verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Martin" }),
      call(conversationId, "get_disrupted_booking"),
    ]);
    expect(results.map((result) => result.body.result.ok)).toEqual([true, true]);
    expect(results[1].body.state).toBe("BOOKING_LOADED");
  });

  it("replays a retried tool request without counting a failed identity check twice", async () => {
    const { conversationId } = await open();
    const args = { bookingReference: "SKY82Q", lastName: "Dubois" };
    const first = await call(conversationId, "verify_passenger_identity", args, "same-call");
    const replay = await call(conversationId, "verify_passenger_identity", args, "same-call");
    expect(replay.body).toEqual(first.body);
    expect(await prisma.auditEvent.count({ where: { action: "VERIFICATION_FAILED" } })).toBe(1);
    expect((await call(conversationId, "get_disrupted_booking", {}, "same-call")).response.status).toBe(409);
    const secondAttempt = await call(conversationId, "verify_passenger_identity", args);
    expect(secondAttempt.body.result).toMatchObject({ ok: false, conversationState: "ESCALATED" });
    expect(await prisma.supportCase.count()).toBe(1);
  });

  it("requires confirmed=true, rebooks once, and preserves the confirmed seat on disconnect", async () => {
    const { conversationId } = await open();
    await hold(conversationId);
    expect((await call(conversationId, "confirm_flight_rebooking", { confirmed: false })).body.result.code).toBe("CONFIRMATION_REQUIRED");
    const confirmed = await call(conversationId, "confirm_flight_rebooking", { confirmed: true }, "confirm-once");
    const replay = await call(conversationId, "confirm_flight_rebooking", { confirmed: true }, "confirm-once");
    expect(confirmed.body.state).toBe("REBOOKED");
    expect(replay.body).toEqual(confirmed.body);
    expect(JSON.stringify(confirmed.body)).not.toMatch(/sessionId|holdId|flightId|idempotencyKey/);
    expect((await end(request("end", { conversationId }))).status).toBe(200);
    expect((await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).availableSeats).toBe(16);
    expect(await prisma.auditEvent.count({ where: { action: "REBOOKING_CONFIRMED" } })).toBe(1);
  });

  it("releases an unconfirmed hold exactly once when the call ends", async () => {
    const { conversationId } = await open();
    await hold(conversationId);
    const ended = await end(request("end", { conversationId }));
    expect(await ended.json()).toMatchObject({ ok: true, holdActive: false, state: "OPTIONS_PRESENTED" });
    await end(request("end", { conversationId }));
    expect((await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).availableSeats).toBe(17);
    expect(await prisma.auditEvent.count({ where: { action: "HOLD_CANCELLED" } })).toBe(1);
    expect((await call(conversationId, "search_alternative_flights")).response.status).toBe(410);
  });

  it("releases the seat before creating a support case", async () => {
    const { conversationId } = await open();
    await hold(conversationId);
    const escalated = await call(conversationId, "transfer_to_human_agent", { reason: "PASSENGER_REQUEST" });
    expect(escalated.body).toMatchObject({ state: "ESCALATED", holdActive: false, result: { handoverStatus: "SUPPORT_CASE_CREATED" } });
    expect((await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).availableSeats).toBe(17);
    expect(await prisma.supportCase.count()).toBe(1);
    expect((await end(request("end", { conversationId }))).status).toBe(200);
  });

  it("rejects unknown tools, expired session IDs, and malformed JSON", async () => {
    const { conversationId } = await open();
    expect((await call(conversationId, "invent_flight")).response.status).toBe(400);
    expect((await call("missing", "get_disrupted_booking")).response.status).toBe(404);
    expect((await tool(new Request("http://localhost:3000/api/voice/tools", { method: "POST", body: "broken" }))).status).toBe(400);
  });
});
