import { POST as startSession } from "@/app/api/tools/start-session/route";
import { localVoiceGuard, privateResponse } from "@/server/voice/access";
import { getSignedVoiceUrl, VoiceConnectionError } from "@/server/voice/elevenlabs";
import { createVoiceSession } from "@/server/voice/sessions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const denied = localVoiceGuard(request);
  if (denied) return denied;
  let signedUrl: string;
  try {
    signedUrl = await getSignedVoiceUrl();
  } catch (error) {
    return privateResponse({ ok: false, error: error instanceof VoiceConnectionError ? error.message : "Voice is unavailable." }, 503);
  }
  const created = await startSession(new Request("http://internal/api/tools/start-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.TOOLS_API_KEY ?? "" },
    body: JSON.stringify({ channel: "VOICE" }),
  }));
  if (!created.ok) return privateResponse({ ok: false, error: "Could not open the airline session." }, 503);
  const body = await created.json();
  const conversationId = createVoiceSession(body.data.sessionId);
  return privateResponse({ ok: true, conversationId, signedUrl, state: body.data.state });
}
