import { toolRoute } from "@/server/http/handler";
import { startSessionSchema } from "@/server/http/schemas";
import { createSession } from "@/server/services/verification-service";

export const runtime = "nodejs";

/** ElevenLabs tool: start_conversation_session */
export const POST = toolRoute("start-session", startSessionSchema, ({ channel }) =>
  createSession(channel ?? "VOICE"),
);
