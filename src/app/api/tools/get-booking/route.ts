import { toolRoute } from "@/server/http/handler";
import { getBookingSchema } from "@/server/http/schemas";
import { getDisruptedBooking } from "@/server/services/booking-service";

export const runtime = "nodejs";

/** ElevenLabs tool: get_disrupted_booking */
export const POST = toolRoute("get-booking", getBookingSchema, (input) =>
  getDisruptedBooking(input),
);
