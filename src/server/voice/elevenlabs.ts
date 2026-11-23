import { safeProviderStatus, type ProviderStatus } from "./provider-status";

type VoiceFailure = "VOICE_CONFIGURATION_MISSING" | "SIGNED_URL_REFUSED" | "SIGNED_URL_INVALID_RESPONSE" | "SIGNED_URL_TIMEOUT" | "SIGNED_URL_NETWORK_FAILURE";
export class VoiceConnectionError extends Error {
  constructor(message: string, public readonly reason: VoiceFailure, public readonly httpStatus?: number, public readonly providerStatus?: ProviderStatus) { super(message); }
}
const unavailable = "ElevenLabs could not open a conversation. Check the API key, agent ID, and agent access permissions.";

export function voiceConfiguration() {
  return {
    apiKeyConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    agentConfigured: Boolean(process.env.ELEVENLABS_AGENT_ID?.trim()),
  };
}

/** The permanent key and upstream error bodies never cross the server boundary. */
export async function getSignedVoiceUrl(): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!key || !agentId) {
    throw new VoiceConnectionError("Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in the local .env file, then restart the server.", "VOICE_CONFIGURATION_MISSING");
  }
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", agentId);
    const response = await fetch(url, {
      headers: { "xi-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw new VoiceConnectionError(unavailable, "SIGNED_URL_REFUSED", response.status, safeProviderStatus(body));
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!body || typeof body !== "object" || !("signed_url" in body) || typeof body.signed_url !== "string") {
      throw new VoiceConnectionError(unavailable, "SIGNED_URL_INVALID_RESPONSE");
    }
    let signed;
    try { signed = new URL(body.signed_url); }
    catch { throw new VoiceConnectionError(unavailable, "SIGNED_URL_INVALID_RESPONSE"); }
    if (signed.protocol !== "wss:" || signed.hostname !== "api.elevenlabs.io") {
      throw new VoiceConnectionError(unavailable, "SIGNED_URL_INVALID_RESPONSE");
    }
    return signed.toString();
  } catch (error) {
    if (error instanceof VoiceConnectionError) throw error;
    throw new VoiceConnectionError(unavailable, error instanceof Error && error.name === "TimeoutError" ? "SIGNED_URL_TIMEOUT" : "SIGNED_URL_NETWORK_FAILURE");
  }
}
