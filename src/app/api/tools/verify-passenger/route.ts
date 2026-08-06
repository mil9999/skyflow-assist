import { toolRoute } from "@/server/http/handler";
import { verifyPassengerSchema } from "@/server/http/schemas";
import { verifyPassenger } from "@/server/services/verification-service";

export const runtime = "nodejs";

/** ElevenLabs tool: verify_passenger_identity */
export const POST = toolRoute("verify-passenger", verifyPassengerSchema, (input) =>
  verifyPassenger(input),
);
