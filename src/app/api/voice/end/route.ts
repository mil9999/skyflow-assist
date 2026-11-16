import { z } from "zod";

import { localVoiceGuard, privateResponse } from "@/server/voice/access";
import { endVoiceSession, VoiceSessionError } from "@/server/voice/sessions";

export const runtime = "nodejs";
const schema = z.object({ conversationId: z.string().min(1).max(100) }).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = localVoiceGuard(request);
  if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateResponse({ ok: false, error: "Invalid voice session." }, 400);
  try {
    return privateResponse({ ok: true, ...await endVoiceSession(parsed.data.conversationId) });
  } catch (error) {
    return privateResponse({ ok: false, error: error instanceof VoiceSessionError ? error.message : "Could not end the airline session." }, error instanceof VoiceSessionError ? error.status : 500);
  }
}
