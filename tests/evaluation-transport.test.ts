import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionConnectionError } from "@elevenlabs/client";
import { ElevenLabsEvaluationTransport } from "../src/evaluation/elevenlabs-transport";
import { evaluationFailure } from "../src/evaluation/transport-error";

const { startSession, getSignedVoiceUrl } = vi.hoisted(() => ({ startSession: vi.fn(), getSignedVoiceUrl: vi.fn() }));
vi.mock("@elevenlabs/client", async (original) => ({ ...await original<typeof import("@elevenlabs/client")>(), Conversation: { startSession } }));
vi.mock("../src/server/voice/elevenlabs", () => ({ getSignedVoiceUrl }));
afterEach(() => { vi.resetAllMocks(); });

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
