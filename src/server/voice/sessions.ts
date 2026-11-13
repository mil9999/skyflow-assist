import { randomUUID } from "node:crypto";

import { snapshot, snapshotSchema } from "@/agent/conversation-store";
import { redact } from "@/agent/redact";
import { executeTool, getSessionStatus } from "@/agent/tool-executor";
import type { SimulatorConversation, ToolResult, TraceStep } from "@/agent/types";
import { prisma } from "@/server/db/prisma";

export interface VoiceToolResponse {
  result: ToolResult["payload"];
  state: string | null;
  controller: string;
  holdActive: boolean;
  trace: TraceStep;
}

// Only scheduling is in memory. Context, completed responses and closed state
// are persisted, so another process can safely continue completed tool calls.
const queues = new Map<string, Promise<unknown>>();

export class VoiceSessionError extends Error {
  constructor(message: string, public status = 404) { super(message); }
}

export async function createVoiceSession(sessionId: string): Promise<string> {
  const id = `voice_${randomUUID()}`;
  const conversation: SimulatorConversation = { conversationId: id, sessionId, input: [], messages: [], latestOptions: [], createdAt: new Date() };
  await prisma.voiceConversation.create({ data: { id, sessionId, snapshot: snapshot(conversation) } });
  return id;
}

async function load(id: string) {
  const stored = await prisma.voiceConversation.findUnique({ where: { id }, include: { session: true } });
  if (!stored) throw new VoiceSessionError("That voice conversation was not found. Start a new one.");
  const data = snapshotSchema.parse(JSON.parse(stored.snapshot));
  const activeHoldId = ["OPTION_HELD", "AWAITING_CONFIRMATION"].includes(stored.session.state) ? stored.session.activeHoldId ?? undefined : undefined;
  const conversation: SimulatorConversation = {
    ...data, conversationId: id, sessionId: stored.sessionId, createdAt: stored.createdAt, activeHoldId,
    confirmationIdempotencyKey: activeHoldId === data.activeHoldId ? data.confirmationIdempotencyKey : undefined,
  };
  return { stored, conversation };
}

function enqueue<T>(id: string, action: () => Promise<T>): Promise<T> {
  const pending = (queues.get(id) ?? Promise.resolve()).then(action);
  const settled = pending.catch(() => undefined);
  queues.set(id, settled);
  void settled.finally(() => { if (queues.get(id) === settled) queues.delete(id); });
  return pending;
}

async function acquire(id: string, version: number) {
  const result = await prisma.voiceConversation.updateMany({ where: { id, version, busy: false }, data: { busy: true } });
  if (result.count !== 1) throw new VoiceSessionError("A booking operation is running or was interrupted. Wait for it, or start a new conversation; overdue holds can be recovered by the expiry worker.", 409);
}

async function run(conversation: SimulatorConversation, name: string, args: Record<string, unknown>): Promise<VoiceToolResponse> {
  const started = new Date();
  const before = await getSessionStatus(conversation.sessionId);
  const result = await executeTool(conversation, name, JSON.stringify(args));
  const after = await prisma.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } });
  conversation.activeHoldId = ["OPTION_HELD", "AWAITING_CONFIRMATION"].includes(after.state) ? after.activeHoldId ?? undefined : undefined;
  const payload = { ...(result.payload as Record<string, unknown>), conversationState: after.state, controller: after.controller };
  return {
    result: payload, state: after.state, controller: after.controller, holdActive: Boolean(conversation.activeHoldId),
    trace: { type: "TOOL", name, startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(),
      request: redact(args), response: redact(payload), httpStatus: result.status, errorCode: result.code,
      stateBefore: before?.state, stateAfter: after.state },
  };
}

export async function runVoiceTool(id: string, callId: string, name: string, args: Record<string, unknown>) {
  return enqueue(id, async () => {
    const { stored, conversation } = await load(id);
    // Even cached AI responses must not keep a taken-over conversation running.
    if (stored.session.controller === "EMPLOYEE") return run(conversation, name, args);
    if (stored.closed) throw new VoiceSessionError("That voice conversation has ended. Start a new one.", 410);
    const signature = JSON.stringify({ name, args });
    const previous = await prisma.voiceToolCall.findUnique({ where: { conversationId_callId: { conversationId: id, callId } } });
    if (previous) {
      if (previous.signature !== signature) throw new VoiceSessionError("A tool call ID cannot be reused for a different request.", 409);
      return JSON.parse(previous.response) as VoiceToolResponse;
    }
    if (await prisma.voiceToolCall.count({ where: { conversationId: id } }) >= 100) throw new VoiceSessionError("This demo conversation reached its tool limit. Start a new conversation.", 429);
    await acquire(id, stored.version);
    const response = await run(conversation, name, args);
    await prisma.$transaction(async (tx) => {
      await tx.voiceToolCall.create({ data: { conversationId: id, callId, signature, response: JSON.stringify(response) } });
      await tx.voiceConversation.update({ where: { id, version: stored.version, busy: true }, data: { snapshot: snapshot(conversation), busy: false, version: { increment: 1 } } });
    });
    return response;
  });
}

/** End the AI transport. A staff-owned hold must stay available to the employee. */
export async function endVoiceSession(id: string) {
  return enqueue(id, async () => {
    const { stored, conversation } = await load(id);
    if (stored.closed) return { state: stored.session.state, controller: stored.session.controller, holdActive: Boolean(conversation.activeHoldId) };
    await acquire(id, stored.version);
    let release: VoiceToolResponse | undefined;
    if (stored.session.controller === "AI" && conversation.activeHoldId) {
      release = await run(conversation, "release_held_flight", {});
      if (!(release.result as { ok: boolean }).ok && release.controller !== "EMPLOYEE") throw new VoiceSessionError("Could not release the held seat. Try ending again.", 409);
    }
    await prisma.voiceConversation.update({ where: { id, version: stored.version, busy: true }, data: { closed: true, busy: false, snapshot: snapshot(conversation), version: { increment: 1 } } });
    const current = await getSessionStatus(conversation.sessionId);
    return { state: current?.state, controller: current?.controller, holdActive: Boolean(conversation.activeHoldId), release };
  });
}

export function clearVoiceSessions() { queues.clear(); }
