import type { ModelTool } from "@/server/llm/provider";

/**
 * Strict mode requires additionalProperties:false and every property listed in
 * required, so optional arguments are expressed as nullable instead.
 *
 * Note what is absent: sessionId, holdId, flightId, idempotencyKey. The model
 * never sees or supplies an internal identifier — the executor injects them.
 */
const object = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const AGENT_TOOLS: ModelTool[] = [
  {
    type: "function",
    name: "verify_passenger_identity",
    description:
      "Check the passenger's booking reference and surname. Must succeed before any booking detail is discussed. Returns only whether verification passed.",
    strict: true,
    parameters: object({
      bookingReference: {
        type: "string",
        description: "Booking reference as the passenger said it, e.g. SKY82Q.",
      },
      lastName: { type: "string", description: "The passenger's surname only." },
    }),
  },
  {
    type: "function",
    name: "get_disrupted_booking",
    description:
      "Fetch the passenger's disrupted flight and the reason for the disruption. Call once, after verification succeeds.",
    strict: true,
    parameters: object({}),
  },
  {
    type: "function",
    name: "search_alternative_flights",
    description:
      "Find up to three flights the passenger may be moved to. Call again with preferences if the passenger asks for something specific.",
    strict: true,
    parameters: object({
      directOnly: {
        type: ["boolean", "null"],
        description: "True if the passenger asked to avoid connections. Otherwise null.",
      },
      latestArrivalTime: {
        type: ["string", "null"],
        description:
          "ISO date-time if the passenger must arrive by a certain time. Otherwise null.",
      },
    }),
  },
  {
    type: "function",
    name: "hold_selected_flight",
    description:
      "Reserve a seat on one of the options for ten minutes. Use the optionId exactly as returned by search_alternative_flights.",
    strict: true,
    parameters: object({
      optionId: { type: "string", description: "For example option_1." },
    }),
  },
  {
    type: "function",
    name: "release_held_flight",
    description:
      "Give the held seat back. Call this when the passenger declines the flight, changes their mind, or when a hold has expired.",
    strict: true,
    parameters: object({}),
  },
  {
    type: "function",
    name: "confirm_flight_rebooking",
    description:
      "Move the booking to the held flight. Only call this after the passenger has explicitly agreed to a flight you read back to them.",
    strict: true,
    parameters: object({
      confirmed: {
        type: "boolean",
        description: "True only if the passenger clearly said yes. Never true for a vague answer.",
      },
    }),
  },
  {
    type: "function",
    name: "transfer_to_human_agent",
    description:
      "Hand the conversation to a human colleague. Use when no flights are suitable, the passenger asks for a person, verification has failed twice, or a tool reports a server error.",
    strict: true,
    parameters: object({
      reason: {
        type: "string",
        enum: [
          "VERIFICATION_FAILED",
          "NO_ALTERNATIVE_FLIGHTS",
          "PASSENGER_REQUEST",
          "POLICY_EXCEPTION",
          "BACKEND_ERROR",
        ],
        description: "Why the handover is needed.",
      },
    }),
  },
];

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((tool) => tool.name);
