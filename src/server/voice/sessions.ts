import { randomUUID } from "node:crypto";

import { redact } from "@/agent/redact";
import { executeTool, getSessionState } from "@/agent/tool-executor";
import type { SimulatorConversation, ToolResult, TraceStep } from "@/agent/types";

interface VoiceSession {
  conversation: SimulatorConversation;
  closed: boolean;
  queue: Promise<unknown>;
  calls: Map<string, { signature: string; response: VoiceToolResponse }>;
}

export interface VoiceToolResponse {
  result: ToolResult["payload"];
  state: string | null;
  holdActive: boolean;
  trace: TraceStep;
}

// Local demo only. A server restart loses this context; bookings stay in SQLite.
const sessions = new Map<string, VoiceSession>();

export function createVoiceSession(sessionId: string): string {
  const conversationId = `voice_${randomUUID()}`;
  sessions.set(conversationId, {
    conversation: { conversationId, sessionId, input: [], messages: [], latestOptions: [], createdAt: new Date() },
    closed: false,
    queue: Promise.resolve(),
    calls: new Map(),
  });
  return conversationId;
}

export class VoiceSessionError extends Error {
  constructor(message: string, public status = 404) { super(message); }
}

function getSession(id: string): VoiceSession {
  const session = sessions.get(id);
  if (!session) throw new VoiceSessionError("That voice session has expired. Start a new conversation.");
  return session;
}

function enqueue<T>(session: VoiceSession, action: () => Promise<T>): Promise<T> {
  const pending = session.queue.then(action);
  // A rejected request must not poison all later operations in the session.
  session.queue = pending.catch(() => undefined);
  return pending;
}

async function run(session: VoiceSession, name: string, args: Record<string, unknown>): Promise<VoiceToolResponse> {
  const conversation = session.conversation;
  const started = new Date();
  const stateBefore = await getSessionState(conversation.sessionId);
  const result = await executeTool(conversation, name, JSON.stringify(args));
  const state = await getSessionState(conversation.sessionId);
  // Verification can itself escalate the session. Tell the model explicitly so
  // it does not request a second handover after the backend has already acted.
  const payload = { ...(result.payload as Record<string, unknown>), conversationState: state };
  return {
    result: payload,
    state,
    holdActive: Boolean(conversation.activeHoldId),
    trace: {
      type: "TOOL", name, startedAt: started.toISOString(), durationMs: Date.now() - started.getTime(),
      request: redact(args), response: redact(payload), httpStatus: result.status,
      errorCode: result.code, stateBefore: stateBefore ?? undefined, stateAfter: state ?? undefined,
    },
  };
}

export async function runVoiceTool(id: string, callId: string, name: string, args: Record<string, unknown>) {
  const session = getSession(id);
  return enqueue(session, async () => {
    if (session.closed) throw new VoiceSessionError("That voice conversation has ended. Start a new one.", 410);
    const signature = JSON.stringify({ name, args });
    const previous = session.calls.get(callId);
    if (previous) {
      if (previous.signature !== signature) throw new VoiceSessionError("A tool call ID cannot be reused for a different request.", 409);
      return previous.response;
    }
    if (session.calls.size >= 100) throw new VoiceSessionError("This demo session reached its tool limit. End the conversation and start again.", 429);
    const response = await run(session, name, args);
    session.calls.set(callId, { signature, response });
    return response;
  });
}

/** Release an unconfirmed seat on normal disconnect; never undo a rebooking. */
export async function endVoiceSession(id: string) {
  const session = getSession(id);
  return enqueue(session, async () => {
    let release: VoiceToolResponse | undefined;
    if (!session.closed && session.conversation.activeHoldId) {
      release = await run(session, "release_held_flight", {});
      const payload = release.result as { ok: boolean };
      if (!payload.ok) throw new VoiceSessionError("Could not release the held seat. The booking is unconfirmed; try ending again.", 409);
    }
    session.closed = true;
    return { state: await getSessionState(session.conversation.sessionId), holdActive: false, release };
  });
}

export function clearVoiceSessions() { sessions.clear(); }
