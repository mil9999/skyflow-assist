import { toolRoute } from "@/server/http/handler";
import { cancelHoldSchema } from "@/server/http/schemas";
import { cancelHold } from "@/server/services/rebooking-service";

export const runtime = "nodejs";

/**
 * ElevenLabs tool: release_held_flight
 * Called when the passenger declines a held flight or changes their mind.
 */
export const POST = toolRoute("cancel-hold", cancelHoldSchema, (input) => cancelHold(input));
