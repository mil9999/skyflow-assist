import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSignedVoiceUrl, VoiceConnectionError } from "../src/server/voice/elevenlabs";
import { safeProviderStatus } from "../src/server/voice/provider-status";
import { evaluationFailure } from "../src/evaluation/transport-error";

const privateValue = "private-fixture-secret-and-account";
beforeEach(() => { vi.stubEnv("ELEVENLABS_API_KEY", privateValue); vi.stubEnv("ELEVENLABS_AGENT_ID", "private-agent"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("whitelisted provider status", () => {
  it.each(["invalid_api_key", "quota_exceeded", "too_many_concurrent_requests", "system_busy"])("recognizes %s without retaining accompanying details", (status) => {
    expect(safeProviderStatus(`${status}: ${privateValue}`)).toBe(status);
    expect(safeProviderStatus(JSON.stringify({ detail: { status, message: privateValue }, headers: { key: privateValue } }))).toBe(status);
  });
  it.each(["wss://api.elevenlabs.io/?token=quota_exceeded", "private quota_exceeded text", "__proto__", "system_busy/private-token", "x".repeat(2049)])("does not infer a status from arbitrary text", (text) => {
    expect(safeProviderStatus(text)).toBeUndefined();
  });
  it("rejects unknown or malformed provider objects", () => {
    for (const body of [null, {}, { detail: privateValue }, { detail: { status: "__proto__" } }, "{bad json"]) expect(safeProviderStatus(body)).toBeUndefined();
  });
});

describe("signed-URL failure diagnostics", () => {
  it.each([
    [401, "invalid_api_key"], [403, "quota_exceeded"], [429, "too_many_concurrent_requests"], [503, "system_busy"],
  ] as const)("retains safe fields on HTTP %i while excluding response extras", async (httpStatus, status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: { status, message: privateValue }, signed_url: `wss://api.elevenlabs.io/?token=${privateValue}` }, { status: httpStatus })));
    let failure;
    try { await getSignedVoiceUrl(); } catch (error) {
      expect(error).toBeInstanceOf(VoiceConnectionError);
      failure = evaluationFailure(error);
      expect((error as Error).message).not.toContain(privateValue);
    }
    expect(failure).toEqual({ reason: "SIGNED_URL_REFUSED", connectionStage: "signed-url", httpStatus, providerStatus: status });
    expect(JSON.stringify(failure)).not.toMatch(/private-|signed_url|headers/);
  });
  it("retains HTTP status when the error response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(privateValue, { status: 502 })));
    await expect(getSignedVoiceUrl()).rejects.toMatchObject({ reason: "SIGNED_URL_REFUSED", httpStatus: 502, providerStatus: undefined });
  });
  it.each([null, {}, { signed_url: 42 }, { signed_url: "not a URL" }, { signed_url: `https://example.com/?token=${privateValue}` }])("classifies a malformed signed URL without exposing its value", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(getSignedVoiceUrl()).rejects.toMatchObject({ reason: "SIGNED_URL_INVALID_RESPONSE" });
  });
  it.each([["TimeoutError", "SIGNED_URL_TIMEOUT"], ["TypeError", "SIGNED_URL_NETWORK_FAILURE"]])("distinguishes %s without returning its sensitive message", async (name, reason) => {
    const error = new Error(privateValue); error.name = name;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    let failure;
    try { await getSignedVoiceUrl(); } catch (caught) { failure = evaluationFailure(caught); }
    expect(failure).toEqual({ reason, connectionStage: "signed-url" });
    expect(JSON.stringify(failure)).not.toContain(privateValue);
  });
  it("reports missing configuration before making an upstream request", async () => {
    vi.stubEnv("ELEVENLABS_AGENT_ID", " ");
    vi.stubGlobal("fetch", vi.fn());
    await expect(getSignedVoiceUrl()).rejects.toMatchObject({ reason: "VOICE_CONFIGURATION_MISSING" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
