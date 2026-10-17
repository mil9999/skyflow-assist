import { POST as cancelHoldRoute } from "@/app/api/tools/cancel-hold/route";
import { POST as confirmRebookingRoute } from "@/app/api/tools/confirm-rebooking/route";
import { POST as escalateRoute } from "@/app/api/tools/escalate/route";
import { POST as getBookingRoute } from "@/app/api/tools/get-booking/route";
import { POST as holdFlightRoute } from "@/app/api/tools/hold-flight/route";
import { POST as searchFlightsRoute } from "@/app/api/tools/search-flights/route";
import { POST as verifyPassengerRoute } from "@/app/api/tools/verify-passenger/route";
import { prisma } from "@/server/db/prisma";
import type { FailureBody, SuccessBody } from "@/server/http/respond";
import type { DisruptedBookingResult } from "@/server/services/booking-service";
import type { EscalateResult } from "@/server/services/escalation-service";
import type { SearchResult } from "@/server/services/flight-search-service";
import type { CancelHoldResult, ConfirmResult, HoldResult } from "@/server/services/rebooking-service";
import type { VerifyPassengerResult } from "@/server/services/verification-service";
import type { SimulatorConversation, StoredFlightOption, ToolResult } from "./types";

type Route = (request: Request) => Promise<Response>;
type RouteResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: FailureBody };

/**
 * The executor calls the Phase 3 route handlers in-process rather than over the
 * network. Same authentication, same validation, same status codes — but no base
 * URL to configure and no server required in tests.
 */
async function callRoute<T>(route: Route, body: unknown): Promise<RouteResult<T>> {
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
  const envelope = (await response.json()) as SuccessBody<T> | FailureBody;
  return envelope.ok
    ? { ok: true, status: response.status, data: envelope.data }
    : { ok: false, status: response.status, error: envelope };
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
function passThrough(result: Extract<RouteResult<unknown>, { ok: false }>): ToolResult {
  return {
    ok: false,
    status: result.status,
    code: result.error.code,
    payload: { ok: false, code: result.error.code, message: result.error.message },
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
      const result = await callRoute<VerifyPassengerResult>(verifyPassengerRoute, {
        sessionId: conversation.sessionId,
        bookingReference: String(args.bookingReference ?? ""),
        lastName: String(args.lastName ?? ""),
      });
      if (!result.ok) return passThrough(result);
      return success({ verified: true, bookingReference: result.data.bookingReference });
    }

    /* ---------------------------------------------------------------- */
    case "get_disrupted_booking": {
      const result = await callRoute<DisruptedBookingResult>(getBookingRoute, { sessionId: conversation.sessionId });
      if (!result.ok) return passThrough(result);
      return success({
        bookingReference: result.data.bookingReference,
        flight: result.data.flight,
        disruption: result.data.disruption,
      });
    }

    /* ---------------------------------------------------------------- */
    case "search_alternative_flights": {
      const body: Record<string, unknown> = { sessionId: conversation.sessionId };
      if (args.directOnly === true) body.directOnly = true;
      if (typeof args.latestArrivalTime === "string" && args.latestArrivalTime.length > 0) {
        body.latestArrivalTime = args.latestArrivalTime;
      }

      const result = await callRoute<SearchResult>(searchFlightsRoute, body);
      if (!result.ok) return passThrough(result);

      const options = result.data.options as StoredFlightOption[];
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

      const result = await callRoute<HoldResult>(holdFlightRoute, {
        sessionId: conversation.sessionId,
        flightId: option.flightId,
      });
      if (!result.ok) return passThrough(result);

      conversation.activeHoldId = result.data.holdId;
      // A new hold means a new confirmation, so the old key must not be reused.
      conversation.confirmationIdempotencyKey = undefined;

      return success({
        flightNumber: result.data.flightNumber,
        expiresAt: result.data.expiresAt,
        requiresConfirmation: true,
      });
    }

    /* ---------------------------------------------------------------- */
    case "release_held_flight": {
      if (!conversation.activeHoldId) {
        return failure("INVALID_STATE", "There is no held seat to release.");
      }

      const result = await callRoute<CancelHoldResult>(cancelHoldRoute, {
        sessionId: conversation.sessionId,
        holdId: conversation.activeHoldId,
      });
      if (!result.ok) return passThrough(result);

      conversation.activeHoldId = undefined;
      conversation.confirmationIdempotencyKey = undefined;

      return success({ released: true, status: result.data.status });
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

      const result = await callRoute<ConfirmResult>(confirmRebookingRoute, {
        sessionId: conversation.sessionId,
        holdId: conversation.activeHoldId,
        confirmed: true,
        idempotencyKey: conversation.confirmationIdempotencyKey,
      });
      if (!result.ok) return passThrough(result);

      conversation.activeHoldId = undefined;

      return success({
        bookingReference: result.data.bookingReference,
        newFlight: result.data.newFlight,
      });
    }

    /* ---------------------------------------------------------------- */
    case "transfer_to_human_agent": {
      // A handover must not strand a seat in a terminal conversation.
      if (conversation.activeHoldId) {
        const released = await callRoute<CancelHoldResult>(cancelHoldRoute, {
          sessionId: conversation.sessionId,
          holdId: conversation.activeHoldId,
        });
        if (!released.ok) return passThrough(released);
        conversation.activeHoldId = undefined;
        conversation.confirmationIdempotencyKey = undefined;
      }
      const result = await callRoute<EscalateResult>(escalateRoute, {
        sessionId: conversation.sessionId,
        reason: String(args.reason ?? "PASSENGER_REQUEST"),
      });
      if (!result.ok) return passThrough(result);

      return success({
        transferred: true,
        handoverStatus: "SUPPORT_CASE_CREATED",
        reference: result.data.reference,
      });
    }

    /* ---------------------------------------------------------------- */
    default:
      return failure("BAD_REQUEST", `There is no tool called ${name}.`, 400);
  }
}
