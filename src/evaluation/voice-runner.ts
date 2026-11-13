import { createVoiceSession, endVoiceSession, runVoiceTool } from "../server/voice/sessions";
import { createSession } from "../server/services/verification-service";
import { prisma } from "../server/db/prisma";
import { resetDemoScenario } from "../server/demo/scenario";
import { expireDueHolds } from "../server/services/rebooking-service";
import { takeOver } from "../server/employee/service";
import { getEvaluationAgentConfiguration } from "./agent-configuration";
import { evaluationFailure } from "./transport-error";
import type { EvaluationToolCall, VoiceEvaluationScenario } from "./voice-scenarios";

export interface EvaluationTransport {
  start: (tool: (name: string, args: Record<string, unknown>) => Promise<string>) => Promise<void>;
  exchange: (message: string) => Promise<string>;
  end: () => Promise<void>;
}

export async function evaluateConfiguredVoiceScenario(scenario: VoiceEvaluationScenario, transport: EvaluationTransport, readConfiguration = getEvaluationAgentConfiguration) {
  const configuration = await readConfiguration();
  const result = await evaluateVoiceScenario(scenario, transport);
  let after;
  try { after = await readConfiguration(); }
  catch (error) { return { ...result, passed: false, outcome: "inconclusive", ...evaluationFailure(error), configurationBefore: configuration }; }
  if (configuration.fingerprint !== after.fingerprint) {
    return { ...result, passed: false, outcome: "inconclusive", reason: "AGENT_CONFIGURATION_CHANGED", configurationBefore: configuration, configurationAfter: after };
  }
  return { ...result, outcome: result.outcome ?? (result.passed ? "passed" : "failed"), configuration };
}

/** Caller must supply a disposable, migrated database before importing Prisma. */
export async function evaluateVoiceScenario(scenario: VoiceEvaluationScenario, transport: EvaluationTransport) {
  await resetDemoScenario();
  const { sessionId } = await createSession("VOICE");
  const conversationId = await createVoiceSession(sessionId);
  const steps: { index: number; state: string; checks: { name: string; passed: boolean }[]; tools: EvaluationToolCall[] }[] = [];
  let currentCalls: EvaluationToolCall[] = [];
  let callNumber = 0;
  let expiredHoldId: string | undefined;
  let aiProbeDenied = false;
  let transportEnded = false;
  async function disconnect() {
    if (!transportEnded) { await transport.end(); transportEnded = true; }
    await endVoiceSession(conversationId);
  }
  const started = Date.now();
  try {
    await transport.start(async (name, args) => {
      const response = await runVoiceTool(conversationId, `evaluation:${++callNumber}`, name, args);
      const result = response.result as { ok?: boolean };
      currentCalls.push({ name, ok: result.ok === true, ...(typeof args.confirmed === "boolean" ? { confirmed: args.confirmed } : {}) });
      return JSON.stringify(response.result);
    });
    for (const [index, step] of scenario.steps.entries()) {
      currentCalls = [];
      if (step.before === "expire-hold") {
        const session = await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId } });
        if (!session.activeHoldId) throw new Error("Expiry scenario requires an active hold.");
        expiredHoldId = session.activeHoldId;
        await prisma.rebookingHold.update({ where: { id: expiredHoldId }, data: { expiresAt: new Date(Date.now() - 1000) } });
        await expireDueHolds();
      }
      if (step.before === "employee-takeover") {
        await takeOver(sessionId);
        // A deliberate delayed-request probe, separate from model tool calls.
        const probe = await runVoiceTool(conversationId, "evaluation:takeover-probe", "confirm_flight_rebooking", { confirmed: true });
        aiProbeDenied = (probe.result as { code?: string }).code === "SESSION_TAKEN_OVER";
      }
      const reply = await transport.exchange(step.message);
      if (step.after === "disconnect-ai") await disconnect();
      const session = await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId }, include: { supportCases: true } });
      const reference = scenario.id === "no-alternatives" ? "SKY55T" : "SKY82Q";
      const booking = await prisma.booking.findUniqueOrThrow({ where: { bookingReference: reference }, include: { flight: true } });
      const held = session.activeHoldId ? await prisma.rebookingHold.findUnique({ where: { id: session.activeHoldId }, include: { newFlight: true } }) : null;
      const checks = step.check({ state: session.state, bookingLinked: Boolean(session.bookingId), bookingStatus: booking.status, flight: booking.flight.flightNumber,
        heldFlight: held?.status === "ACTIVE" ? held.newFlight.flightNumber : null,
        sf218Seats: (await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).availableSeats,
        sf224Seats: (await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF224" } })).availableSeats,
        controller: session.controller, aiProbeDenied, freshHold: Boolean(session.activeHoldId && expiredHoldId && session.activeHoldId !== expiredHoldId),
        activeHolds: await prisma.rebookingHold.count({ where: { bookingId: booking.id, status: "ACTIVE" } }),
        expiredHolds: await prisma.rebookingHold.count({ where: { bookingId: booking.id, status: "EXPIRED" } }),
        confirmations: await prisma.auditEvent.count({ where: { sessionId, action: "REBOOKING_CONFIRMED" } }),
        verificationFailures: await prisma.auditEvent.count({ where: { sessionId, action: "VERIFICATION_FAILED" } }), supportReasons: session.supportCases.map((item) => item.reason), reply, calls: currentCalls });
      steps.push({ index: index + 1, state: session.state, checks, tools: currentCalls });
      // Stop at the first failure. Later steps could hide a premature change.
      if (checks.some((item) => !item.passed)) break;
    }
    const passed = steps.length === scenario.steps.length && steps.every((step) => step.checks.every((item) => item.passed));
    return { scenario: scenario.id, passed, outcome: passed ? "passed" : "failed", durationMs: Date.now() - started, steps };
  } catch (error) {
    return { scenario: scenario.id, passed: false, outcome: "inconclusive", durationMs: Date.now() - started, steps, ...evaluationFailure(error) };
  } finally {
    try { await disconnect(); }
    finally { await endVoiceSession(conversationId); }
  }
}
