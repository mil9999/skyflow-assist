import { toolRoute } from "@/server/http/handler";
import { confirmRebookingSchema } from "@/server/http/schemas";
import { confirmRebooking } from "@/server/services/rebooking-service";

export const runtime = "nodejs";

/**
 * ElevenLabs tool: confirm_flight_rebooking
 * The only write the agent can trigger, and only with confirmed === true.
 */
export const POST = toolRoute("confirm-rebooking", confirmRebookingSchema, (input) =>
  confirmRebooking(input),
);
