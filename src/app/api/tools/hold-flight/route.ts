import { toolRoute } from "@/server/http/handler";
import { holdFlightSchema } from "@/server/http/schemas";
import { holdAlternativeFlight } from "@/server/services/rebooking-service";

export const runtime = "nodejs";

/** ElevenLabs tool: hold_selected_flight */
export const POST = toolRoute("hold-flight", holdFlightSchema, (input) =>
  holdAlternativeFlight(input),
);
