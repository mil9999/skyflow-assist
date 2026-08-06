import { toolRoute } from "@/server/http/handler";
import { searchFlightsSchema } from "@/server/http/schemas";
import { searchAlternativeFlights } from "@/server/services/flight-search-service";

export const runtime = "nodejs";

/** ElevenLabs tool: search_alternative_flights */
export const POST = toolRoute("search-flights", searchFlightsSchema, (input) =>
  searchAlternativeFlights(input),
);
