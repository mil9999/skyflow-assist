import { z } from "zod";

import { getConversation, snapshotSchema } from "@/agent/conversation-store";
import { AuditAction } from "@/domain/constants";
import { DomainError, ErrorCode } from "@/domain/errors";
import { prisma } from "@/server/db/prisma";
import { record } from "@/server/services/audit-service";
import { getDisruptedBooking } from "@/server/services/booking-service";
import { appendEntry, appendTextHistory } from "@/server/services/conversation-log";
import { searchAlternativeFlights } from "@/server/services/flight-search-service";
import { cancelHold, confirmRebooking, holdAlternativeFlight, releaseAndRewind } from "@/server/services/rebooking-service";
import { assertSessionActor } from "@/server/services/session-control";
import { verifyPassenger } from "@/server/services/verification-service";

export const employeeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("takeover") }).strict(),
  z.object({ action: z.literal("verify"), bookingReference: z.string().min(1).max(40), lastName: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("load") }).strict(),
  z.object({ action: z.literal("search"), directOnly: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("hold"), flightId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("release") }).strict(),
  z.object({ action: z.literal("confirm"), holdId: z.string().min(1), confirmed: z.boolean() }).strict(),
  z.object({ action: z.literal("message"), content: z.string().trim().min(1).max(4000), messageId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal("resolve") }).strict(),
]);
export type EmployeeAction = z.infer<typeof employeeActionSchema>;

export async function takeOver(sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.conversationSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.controller === "EMPLOYEE" && session.state !== "ESCALATED") return session;
    let state = session.state;
    if (state === "ESCALATED") {
      const support = await tx.supportCase.findFirst({ where: { sessionId }, orderBy: { createdAt: "desc" } });
      state = !session.bookingId || support?.escalatedFromState === "UNVERIFIED" ? "UNVERIFIED"
        : support?.escalatedFromState === "VERIFIED" ? "VERIFIED" : "BOOKING_LOADED";
      if (session.activeHoldId) {
        const held = await tx.rebookingHold.findUnique({ where: { id: session.activeHoldId } });
        if (held?.status === "ACTIVE") await releaseAndRewind(tx, held, session, "CANCELLED");
      }
      await record(tx, sessionId, AuditAction.HUMAN_REVIEW_RESUMED, { from: session.state, to: state });
    }
    const updated = await tx.conversationSession.update({ where: { id: sessionId }, data: {
      controller: "EMPLOYEE", takenOverAt: session.takenOverAt ?? new Date(), state,
      ...(session.state === "ESCALATED" ? { activeHoldId: null } : {}),
    } });
    await tx.voiceConversation.updateMany({ where: { sessionId }, data: { closed: true } });
    const text = await tx.textConversation.findUnique({ where: { sessionId } });
    if (text) await appendTextHistory(tx, sessionId, snapshotSchema.parse(JSON.parse(text.snapshot)).messages);
    await appendEntry(tx, sessionId, `takeover:${session.updatedAt.toISOString()}`, "SYSTEM", "An employee has joined. Continue here by text; automated booking actions have stopped.");
    await record(tx, sessionId, AuditAction.EMPLOYEE_TAKEOVER);
    return updated;
  });
}

export async function employeeAction(sessionId: string, action: EmployeeAction) {
  if (action.action === "takeover") return takeOver(sessionId);
  const session = await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId } });
  assertSessionActor(session, "EMPLOYEE");
  switch (action.action) {
    case "verify": return verifyPassenger({ sessionId, bookingReference: action.bookingReference, lastName: action.lastName }, "EMPLOYEE");
    case "load": return getDisruptedBooking({ sessionId }, "EMPLOYEE");
    case "search": return searchAlternativeFlights({ sessionId, directOnly: action.directOnly }, "EMPLOYEE");
    case "hold": return holdAlternativeFlight({ sessionId, flightId: action.flightId }, "EMPLOYEE");
    case "release": {
      if (!session.activeHoldId) throw new DomainError(ErrorCode.INVALID_STATE, "There is no active hold.");
      return cancelHold({ sessionId, holdId: session.activeHoldId }, "EMPLOYEE");
    }
    case "confirm": {
      if (!session.activeHoldId || session.activeHoldId !== action.holdId) throw new DomainError(ErrorCode.INVALID_STATE, "The held flight changed. Refresh, read it back, and obtain a new confirmation.");
      return confirmRebooking({ sessionId, holdId: session.activeHoldId, confirmed: action.confirmed, idempotencyKey: `employee:${sessionId}:confirm:${session.activeHoldId}` }, "EMPLOYEE");
    }
    case "message": return prisma.$transaction(async (tx) => {
      const message = await appendEntry(tx, sessionId, `employee:${action.messageId}`, "EMPLOYEE", action.content);
      const existingAudit = await tx.auditEvent.findFirst({ where: { sessionId, action: AuditAction.EMPLOYEE_MESSAGE_SENT, details: JSON.stringify({ messageId: message.id }) } });
      if (!existingAudit) await record(tx, sessionId, AuditAction.EMPLOYEE_MESSAGE_SENT, { messageId: message.id });
      return { sent: true };
    });
    case "resolve": return prisma.$transaction(async (tx) => {
      const result = await tx.supportCase.updateMany({ where: { sessionId, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      if (result.count) await record(tx, sessionId, AuditAction.SUPPORT_CASE_RESOLVED, { count: result.count });
      return { resolved: result.count };
    });
  }
}

export async function listEmployeeSessions() {
  const sessions = await prisma.conversationSession.findMany({
    orderBy: { updatedAt: "desc" }, take: 100,
    include: { transcript: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } }, booking: { include: { passenger: true, flight: true } }, supportCases: { where: { status: "OPEN" }, select: { id: true } }, textConversation: { select: { busy: true } }, voiceConversation: { select: { busy: true } } },
  });
  return sessions.map((session) => ({
    id: session.id, channel: session.channel, state: session.state, controller: session.controller, preview: session.transcript[0]?.content.slice(0, 100) ?? "Conversation started",
    updatedAt: session.updatedAt, waiting: session.supportCases.length > 0, working: Boolean(session.textConversation?.busy || session.voiceConversation?.busy),
    passenger: session.booking ? `${session.booking.passenger.firstName} ${session.booking.passenger.lastName}` : "Identity not verified",
    reference: session.booking?.bookingReference ?? null,
    route: session.booking ? `${session.booking.flight.origin} → ${session.booking.flight.destination}` : null,
  }));
}

export async function employeeDetail(sessionId: string) {
  const session = await prisma.conversationSession.findUnique({
    where: { id: sessionId }, include: {
      booking: { include: { flight: true } }, supportCases: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, action: true, createdAt: true } },
      transcript: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500, select: { id: true, role: true, content: true, createdAt: true } },
      textConversation: { select: { id: true, busy: true } }, voiceConversation: { select: { id: true, busy: true, closed: true } },
    },
  });
  if (!session) return null;
  let messages: { id: string; role: string; content: string; createdAt: Date }[] = session.transcript;
  // Older checkpoints predate the shared transcript table.
  if (!messages.length && session.textConversation) {
    const old = await getConversation(session.textConversation.id);
    messages = (old?.messages ?? []).map((entry, i) => ({ id: `old:${i}`, role: entry.role === "user" ? "USER" : "ASSISTANT", content: entry.content, createdAt: new Date(entry.at) }));
  }
  const held = session.activeHoldId ? await prisma.rebookingHold.findUnique({ where: { id: session.activeHoldId }, include: { newFlight: true } }) : null;
  return {
    id: session.id, state: session.state, channel: session.channel, controller: session.controller, takenOverAt: session.takenOverAt,
    conversationId: session.textConversation?.id ?? session.voiceConversation?.id,
    working: Boolean(session.textConversation?.busy || session.voiceConversation?.busy),
    booking: session.booking ? { reference: session.booking.bookingReference, status: session.booking.status, flight: session.booking.flight.flightNumber, seat: session.booking.seatNumber, route: `${session.booking.flight.origin} → ${session.booking.flight.destination}` } : null,
    hold: held?.status === "ACTIVE" ? { id: held.id, flightNumber: held.newFlight.flightNumber, departureTime: held.newFlight.departureTime, arrivalTime: held.newFlight.arrivalTime, expiresAt: held.expiresAt } : null,
    messages, events: session.events, supportCases: session.supportCases.map(({ id, status, reason }) => ({ id, status, reason })),
  };
}
