import { toolRoute } from "@/server/http/handler";
import { escalateSchema } from "@/server/http/schemas";
import { escalateSession } from "@/server/services/escalation-service";

export const runtime = "nodejs";

/** ElevenLabs tool: transfer_to_human_agent */
export const POST = toolRoute("escalate", escalateSchema, (input) => escalateSession(input));
