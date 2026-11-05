import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/server/db/prisma";
import type { SimulatorConversation } from "./types";

const snapshotSchema = z.object({
  input: z.array(z.record(z.string(), z.unknown())),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string(), at: z.string(),
  })),
  latestOptions: z.array(z.object({
    optionId: z.string(), flightId: z.string(), flightNumber: z.string(),
    departureTime: z.string(), arrivalTime: z.string(), connections: z.number(),
    availableSeats: z.number(), additionalCost: z.number(),
  })),
  previousResponseId: z.string().optional(),
  activeHoldId: z.string().optional(),
  confirmationIdempotencyKey: z.string().optional(),
});

function snapshot(conversation: SimulatorConversation): string {
  return JSON.stringify(snapshotSchema.parse(conversation));
}

function heldId(session: { state: string; activeHoldId: string | null }): string | undefined {
  return session.state === "OPTION_HELD" || session.state === "AWAITING_CONFIRMATION"
    ? session.activeHoldId ?? undefined : undefined;
}

export class ConversationConflictError extends Error {
  constructor() {
    super("This conversation changed, has a turn running, or was interrupted. Wait for the current reply, or start a new conversation if it cannot finish.");
  }
}

export async function createConversation(sessionId: string): Promise<SimulatorConversation> {
  const conversation: SimulatorConversation = {
    conversationId: `conv_${randomUUID()}`,
    sessionId,
    input: [],
    messages: [],
    latestOptions: [],
    createdAt: new Date(),
    checkpointVersion: 0,
  };
  await prisma.textConversation.create({
    data: { id: conversation.conversationId, sessionId, snapshot: snapshot(conversation) },
  });
  return conversation;
}

/** Read from storage on every request; Node memory is never the recovery source. */
export async function getConversation(conversationId: string): Promise<SimulatorConversation | undefined> {
  const stored = await prisma.textConversation.findUnique({
    where: { id: conversationId }, include: { session: { select: { state: true, activeHoldId: true } } },
  });
  if (!stored) return undefined;
  const data = snapshotSchema.parse(JSON.parse(stored.snapshot));
  const activeHoldId = heldId(stored.session);
  return {
    ...data, conversationId: stored.id, sessionId: stored.sessionId,
    createdAt: stored.createdAt, checkpointVersion: stored.version, activeHoldId,
    // A sweep or other backend action may have released a checkpoint's hold.
    confirmationIdempotencyKey: activeHoldId && activeHoldId === data.activeHoldId
      ? data.confirmationIdempotencyKey : undefined,
  };
}

/** Acquire before the first model/tool call, including across Node processes. */
export async function beginConversationTurn(conversation: SimulatorConversation): Promise<void> {
  const acquired = await prisma.textConversation.updateMany({
    where: { id: conversation.conversationId, version: conversation.checkpointVersion ?? 0, busy: false },
    data: { busy: true },
  });
  if (acquired.count !== 1) throw new ConversationConflictError();
  const session = await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } });
  const activeHoldId = heldId(session);
  if (activeHoldId !== conversation.activeHoldId) conversation.confirmationIdempotencyKey = undefined;
  conversation.activeHoldId = activeHoldId;
}

/** Only completed turns unlock. A process crash fails closed instead of replaying tools. */
export async function completeConversationTurn(conversation: SimulatorConversation): Promise<void> {
  const saved = await prisma.textConversation.updateMany({
    where: { id: conversation.conversationId, version: conversation.checkpointVersion ?? 0, busy: true },
    data: { snapshot: snapshot(conversation), version: { increment: 1 }, busy: false },
  });
  if (saved.count !== 1) throw new ConversationConflictError();
  conversation.checkpointVersion = (conversation.checkpointVersion ?? 0) + 1;
}
