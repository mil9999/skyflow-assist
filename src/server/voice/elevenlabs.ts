export class VoiceConnectionError extends Error {}

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
    throw new VoiceConnectionError("Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in the local .env file, then restart the server.");
  }
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", agentId);
    const response = await fetch(url, {
      headers: { "xi-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("upstream refused");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("signed_url" in body) || typeof body.signed_url !== "string") {
      throw new Error("invalid upstream response");
    }
    const signed = new URL(body.signed_url);
    if (signed.protocol !== "wss:" || signed.hostname !== "api.elevenlabs.io") {
      throw new Error("unexpected voice host");
    }
    return signed.toString();
  } catch {
    throw new VoiceConnectionError("ElevenLabs could not open a conversation. Check the API key, agent ID, and agent access permissions.");
  }
}
