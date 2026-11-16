import { localVoiceGuard, privateResponse } from "@/server/voice/access";
import { voiceConfiguration } from "@/server/voice/elevenlabs";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const denied = localVoiceGuard(request);
  if (denied) return denied;
  return privateResponse({ ok: true, ...voiceConfiguration() });
}
