import { z } from "zod";

import { AGENT_TOOL_NAMES } from "@/agent/tool-definitions";
import { localVoiceGuard, privateResponse } from "@/server/voice/access";
import { runVoiceTool, VoiceSessionError } from "@/server/voice/sessions";

export const runtime = "nodejs";
const schema = z.object({
  conversationId: z.string().min(1).max(100),
  callId: z.string().min(1).max(200),
  name: z.enum(AGENT_TOOL_NAMES),
  args: z.record(z.string(), z.unknown()),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const denied = localVoiceGuard(request);
  if (denied) return denied;
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return privateResponse({ ok: false, error: "Invalid voice tool request." }, 400);
  const { conversationId, callId, name, args } = parsed.data;
  try {
    return privateResponse({ ok: true, ...await runVoiceTool(conversationId, callId, name, args) });
  } catch (error) {
    return privateResponse({ ok: false, error: error instanceof VoiceSessionError ? error.message : "The booking tool is unavailable." }, error instanceof VoiceSessionError ? error.status : 500);
  }
}
