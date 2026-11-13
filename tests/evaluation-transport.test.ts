import { afterEach, describe, expect, it, vi } from "vitest";
import { Conversation, SessionConnectionError } from "@elevenlabs/client";
import { ElevenLabsEvaluationTransport } from "../src/evaluation/elevenlabs-transport";
import { evaluationFailure } from "../src/evaluation/transport-error";

const { startSession, getSignedVoiceUrl } = vi.hoisted(() => ({ startSession: vi.fn(), getSignedVoiceUrl: vi.fn() }));
vi.mock("@elevenlabs/client", async (original) => ({ ...await original<typeof import("@elevenlabs/client")>(), Conversation: { startSession } }));
vi.mock("../src/server/voice/elevenlabs", () => ({ getSignedVoiceUrl }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });

async function connectedTransport(tool: (name: string, args: Record<string, unknown>) => Promise<string> = async () => "{}") {
  vi.useFakeTimers();
  getSignedVoiceUrl.mockResolvedValue("wss://api.elevenlabs.io/?token=fixture");
  let callbacks!: Parameters<typeof Conversation.startSession>[0];
  const endSession = vi.fn().mockResolvedValue(undefined);
  startSession.mockImplementation(async (options) => {
    callbacks = options;
    // The greeting arrives before startSession resolves, as a real SDK can do.
    callbacks.onMessage?.({ role: "agent", source: "ai", event_id: 1, message: "Hello" });
    return { isOpen: () => true, sendUserMessage: vi.fn(), endSession };
  });
  const transport = new ElevenLabsEvaluationTransport();
  const started = transport.start(tool);
  await vi.advanceTimersByTimeAsync(2000);
  await started;
  const reply = (message: string) => callbacks.onMessage?.({ role: "agent", source: "ai", event_id: 2, message });
  return { transport, callbacks, reply, endSession };
}

describe("safe evaluation connection diagnostics", () => {
  it("records a provider close code while excluding upstream messages and signed URLs", async () => {
    getSignedVoiceUrl.mockResolvedValue("wss://api.elevenlabs.io/?token=private-fixture-token");
    startSession.mockRejectedValue(new SessionConnectionError("private provider details", { closeCode: 3000, closeReason: "private-fixture-token" }));
    const transport = new ElevenLabsEvaluationTransport();
    let failure;
    try { await transport.start(async () => "{}"); } catch (error) { failure = evaluationFailure(error); }
    await transport.end();
    expect(failure).toEqual({ reason: "CONNECTION_REJECTED", connectionCloseCode: 3000 });
    expect(JSON.stringify(failure)).not.toMatch(/private|token|provider details/);
  });
  it("keeps unexpected SDK errors generic", async () => {
    getSignedVoiceUrl.mockResolvedValue("wss://api.elevenlabs.io/?token=private-fixture-token");
    startSession.mockRejectedValue(new Error("secret request headers and signed URL"));
    const transport = new ElevenLabsEvaluationTransport();
    await expect(transport.start(async () => "{}")).rejects.toThrow("Could not start the live ElevenLabs evaluation.");
    await transport.end();
    expect(evaluationFailure(new Error("secret request headers"))).toEqual({ reason: "LOCAL_EVALUATION_ERROR" });
    expect(evaluationFailure(new Error("__proto__"))).toEqual({ reason: "LOCAL_EVALUATION_ERROR" });
  });
});

describe("evaluation reply boundaries", () => {
  it("waits for a final reply after tools settle instead of accepting a preface", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { transport, callbacks, reply } = await connectedTransport(async () => { await gate; return "{}"; });
    let settled = false;
    const response = transport.exchange("Find alternatives");
    void response.then(() => { settled = true; }, () => { settled = true; });
    reply("I will check.");
    const tool = callbacks.clientTools!.search_alternative_flights({});
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false);
    release(); await tool;
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe(false);
    reply("Here are the alternatives.");
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(response).resolves.toBe("I will check.\nHere are the alternatives.");
    await transport.end();
  });

  it("rejects a disconnect after tools when only a pre-tool preface was received", async () => {
    const { transport, callbacks, reply } = await connectedTransport();
    const response = transport.exchange("Find alternatives");
    const rejected = expect(response).rejects.toThrow("before completing its reply");
    reply("I will check.");
    await callbacks.clientTools!.search_alternative_flights({});
    callbacks.onDisconnect?.({ reason: "agent" });
    await rejected;
    await transport.end();
  });

  it("accepts an agent ending the call after a final post-tool reply", async () => {
    const { transport, callbacks, reply } = await connectedTransport();
    const response = transport.exchange("Find alternatives");
    await callbacks.clientTools!.search_alternative_flights({});
    reply("No eligible alternatives; your support case is ready.");
    callbacks.onDisconnect?.({ reason: "agent" });
    await expect(response).resolves.toContain("support case is ready");
    await transport.end();
  });

  it("times out a missing reply and clears timers on shutdown", async () => {
    const { transport, endSession } = await connectedTransport();
    const response = transport.exchange("Find alternatives");
    const rejected = expect(response).rejects.toThrow("No completed agent reply within 45 seconds");
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    await transport.end();
    expect(endSession).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
