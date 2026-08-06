import { POST as cancelHoldRoute } from "@/app/api/tools/cancel-hold/route";
import { POST as confirmRebookingRoute } from "@/app/api/tools/confirm-rebooking/route";
import { POST as escalateRoute } from "@/app/api/tools/escalate/route";
import { POST as getBookingRoute } from "@/app/api/tools/get-booking/route";
import { POST as holdFlightRoute } from "@/app/api/tools/hold-flight/route";
import { POST as searchFlightsRoute } from "@/app/api/tools/search-flights/route";
import { POST as verifyPassengerRoute } from "@/app/api/tools/verify-passenger/route";
import { prisma } from "@/server/db/prisma";
import type { SimulatorConversation, StoredFlightOption, ToolResult } from "./types";

type Route = (request: Request) => Promise<Response>;

/**
 * The executor calls the Phase 3 route handlers in-process rather than over the
 * network. Same authentication, same validation, same status codes — but no base
 * URL to configure and no server required in tests.
 */
async function callRoute(route: Route, body: unknown): Promise<{ status: number; body: any }> {
  const response = await route(
    new Request("http://internal/api/tools", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.TOOLS_API_KEY ?? "",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

const failure = (code: string, message: string, status = 409): ToolResult => ({
  ok: false,
  status,
  code,
  payload: { ok: false, code, message },
});

const success = (payload: Record<string, unknown>, status = 200): ToolResult => ({
  ok: true,
  status,
  payload: { ok: true, ...payload },
});

/** Passes a route failure straight through, so the model sees the real code. */
function passThrough(result: { status: number; body: any }): ToolResult {
  return {
    ok: false,
    status: result.status,
    code: result.body?.code,
    payload: { ok: false, code: result.body?.code, message: result.body?.message },
  };
}

export async function getSessionState(sessionId: string): Promise<string | null> {
  const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
  return session?.state ?? null;
}

const TERMINAL_STATES = new Set(["REBOOKED", "ESCALATED"]);

export async function executeTool(
  conversation: SimulatorConversation,
  name: string,
  argumentsJson: string,
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson || "{}") as Record<string, unknown>;
  } catch {
    return failure("BAD_REQUEST", "Those arguments were not valid JSON.", 400);
  }

  const state = await getSessionState(conversation.sessionId);
  if (state && TERMINAL_STATES.has(state)) {
    return failure(
      "INVALID_STATE",
      state === "REBOOKED"
        ? "This booking has already been changed. There is nothing further to do."
        : "This conversation has been handed to a colleague.",
    );
  }

  switch (name) {
    /* ---------------------------------------------------------------- */
    case "verify_passenger_identity": {
      const result = await callRoute(verifyPassengerRoute, {
        sessionId: conversation.sessionId,
        bookingReference: String(args.bookingReference ?? ""),
        lastName: String(args.lastName ?? ""),
      });
      if (result.status !== 200) return passThrough(result);
      return success({ verified: true, bookingReference: result.body.data.bookingReference });
    }

    /* ---------------------------------------------------------------- */
    case "get_disrupted_booking": {
      const result = await callRoute(getBookingRoute, { sessionId: conversation.sessionId });
      if (result.status !== 200) return passThrough(result);
      return success({
        bookingReference: result.body.data.bookingReference,
        flight: result.body.data.flight,
        disruption: result.body.data.disruption,
      });
    }

    /* ---------------------------------------------------------------- */
    case "search_alternative_flights": {
      const body: Record<string, unknown> = { sessionId: conversation.sessionId };
      if (args.directOnly === true) body.directOnly = true;
      if (typeof args.latestArrivalTime === "string" && args.latestArrivalTime.length > 0) {
        body.latestArrivalTime = args.latestArrivalTime;
      }

      const result = await callRoute(searchFlightsRoute, body);
      if (result.status !== 200) return passThrough(result);

      const options = result.body.data.options as StoredFlightOption[];
      // Real flight IDs stay here, never reaching the model.
      conversation.latestOptions = options;

      return success({
        options: options.map((option) => ({
          optionId: option.optionId,
          flightNumber: option.flightNumber,
          departureTime: option.departureTime,
          arrivalTime: option.arrivalTime,
          connections: option.connections,
        })),
      });
    }

    /* ---------------------------------------------------------------- */
    case "hold_selected_flight": {
      const optionId = String(args.optionId ?? "");
      const option = conversation.latestOptions.find((item) => item.optionId === optionId);
      if (!option) {
        return failure(
          "FLIGHT_UNAVAILABLE",
          "I no longer have that option. Let me search again.",
        );
      }

      const result = await callRoute(holdFlightRoute, {
        sessionId: conversation.sessionId,
        flightId: option.flightId,
      });
      if (result.status !== 200) return passThrough(result);

      conversation.activeHoldId = result.body.data.holdId;
      // A new hold means a new confirmation, so the old key must not be reused.
      conversation.confirmationIdempotencyKey = undefined;

      return success({
        flightNumber: result.body.data.flightNumber,
        expiresAt: result.body.data.expiresAt,
        requiresConfirmation: true,
      });
    }

    /* ---------------------------------------------------------------- */
    case "release_held_flight": {
      if (!conversation.activeHoldId) {
        return failure("INVALID_STATE", "There is no held seat to release.");
      }

      const result = await callRoute(cancelHoldRoute, {
        sessionId: conversation.sessionId,
        holdId: conversation.activeHoldId,
      });
      if (result.status !== 200) return passThrough(result);

      conversation.activeHoldId = undefined;
      conversation.confirmationIdempotencyKey = undefined;

      return success({ released: true, status: result.body.data.status });
    }

    /* ---------------------------------------------------------------- */
    case "confirm_flight_rebooking": {
      if (!conversation.activeHoldId) {
        return failure("INVALID_STATE", "No flight is being held, so there is nothing to confirm.");
      }
      if (args.confirmed !== true) {
        return failure(
          "CONFIRMATION_REQUIRED",
          "The passenger has not clearly agreed yet. Ask a plain yes or no question.",
          422,
        );
      }

      // Generated once per hold and reused on retry, so a repeat can never
      // produce a second rebooking.
      conversation.confirmationIdempotencyKey ??=
        `simulator:${conversation.conversationId}:confirm:${conversation.activeHoldId}`;

      const result = await callRoute(confirmRebookingRoute, {
        sessionId: conversation.sessionId,
        holdId: conversation.activeHoldId,
        confirmed: true,
        idempotencyKey: conversation.confirmationIdempotencyKey,
      });
      if (result.status !== 200) return passThrough(result);

      conversation.activeHoldId = undefined;

      return success({
        bookingReference: result.body.data.bookingReference,
        newFlight: result.body.data.newFlight,
      });
    }

    /* ---------------------------------------------------------------- */
    case "transfer_to_human_agent": {
      const result = await callRoute(escalateRoute, {
        sessionId: conversation.sessionId,
        reason: String(args.reason ?? "PASSENGER_REQUEST"),
      });
      if (result.status !== 200) return passThrough(result);

      return success({
        transferred: true,
        reference: result.body.data.reference,
      });
    }

    /* ---------------------------------------------------------------- */
    default:
      return failure("BAD_REQUEST", `There is no tool called ${name}.`, 400);
  }
}
