import { z } from "zod";

import { getConversation } from "@/agent/conversation-store";
import { runTurn } from "@/agent/conversation-runner";
import type { TraceStep } from "@/agent/types";
import { prisma } from "@/server/db/prisma";
import { FakeProvider, textResponse, toolResponse } from "@/server/llm/fake-provider";
import { POST as resetDemo } from "../reset-demo/route";
import { POST as startSession } from "../sessions/route";

export const runtime = "nodejs";
const schema = z.object({ scenario: z.enum(["rebook", "no-options", "verification-failed"]) });

/** A visibly scripted walkthrough of the real tools; never calls an AI API. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Choose a valid demo scenario." }, { status: 400 });
  }

  // Reuse both reset guards: this operation replaces fictional demo data.
  const reset = await resetDemo();
  if (!reset.ok) return reset;
  const createdResponse = await startSession();
  if (!createdResponse.ok) return createdResponse;
  const created = await createdResponse.json();
  const conversation = getConversation(created.conversationId);
  if (!conversation) throw new Error("Demo conversation was not created.");
  const trace: TraceStep[] = [...created.trace];

  async function turn(message: string, script: ReturnType<typeof textResponse>[]) {
    const result = await runTurn({
      conversation: conversation!,
      userMessage: message,
      provider: new FakeProvider(script),
      model: "scripted-demo",
    });
    trace.push(...result.trace);
    return result;
  }

  const scenario = parsed.data.scenario;
  if (scenario === "verification-failed") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await turn("My reference is SKY82Q and my surname is Dubois.", [
        toolResponse("verify_passenger_identity", { bookingReference: "SKY82Q", lastName: "Dubois" }),
        textResponse(attempt === 0
          ? "I couldn't verify those details. Please give me both your booking reference and surname once more."
          : "I couldn't verify your booking. A colleague will need to help you."),
      ]);
    }
  } else {
    const reference = scenario === "rebook" ? "SKY82Q" : "SKY55T";
    const lastName = scenario === "rebook" ? "Martin" : "Okafor";
    await turn(`My flight was cancelled. My reference is ${reference} and my surname is ${lastName}.`, [
      toolResponse("verify_passenger_identity", { bookingReference: reference, lastName }),
      toolResponse("get_disrupted_booking"),
      toolResponse("search_alternative_flights"),
      ...(scenario === "no-options"
        ? [toolResponse("transfer_to_human_agent", { reason: "NO_ALTERNATIVE_FLIGHTS" })]
        : []),
      textResponse(scenario === "no-options"
        ? "There are no eligible replacement flights. I've requested help from a colleague."
        : "I found replacement flights. I can hold the first option and read it back before you decide."),
    ]);

    if (scenario === "rebook") {
      const option = conversation.latestOptions[0];
      if (!option) throw new Error("The demo requires an available replacement flight.");
      const time = (value: string) => new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      }).format(new Date(value));
      await turn("Please hold the first option.", [
        toolResponse("hold_selected_flight", { optionId: option.optionId }),
        textResponse(`I've held ${option.flightNumber}, departing at ${time(option.departureTime)} and arriving at ${time(option.arrivalTime)} UTC. Do you want me to confirm this flight?`),
      ]);
      await turn("Yes, confirm this flight.", [
        toolResponse("confirm_flight_rebooking", { confirmed: true }),
        textResponse(`Your booking has been changed to ${option.flightNumber}.`),
      ]);
    }
  }

  const session = await prisma.conversationSession.findUniqueOrThrow({
    where: { id: conversation.sessionId },
    include: { events: { orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true } } },
  });
  return Response.json({
    ok: true,
    mode: "scripted",
    conversationId: conversation.conversationId,
    model: "scripted-demo (no AI calls)",
    messages: conversation.messages,
    state: session.state,
    holdActive: Boolean(conversation.activeHoldId),
    trace,
    auditEvents: session.events,
  });
}
