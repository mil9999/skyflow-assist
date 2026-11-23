import { z } from "zod";
import { isDomainError } from "@/domain/errors";

import { ConversationConflictError, getConversation } from "@/agent/conversation-store";
import { runTurn } from "@/agent/conversation-runner";
import { agentModel, agentReasoningEffort, getProvider } from "@/server/llm";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

const schema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(2000),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const conversation = await getConversation(parsed.data.conversationId);
  if (!conversation) {
    return Response.json(
      { ok: false, error: "That conversation was not found. Start a new one." },
      { status: 404 },
    );
  }

  let result;
  try {
    result = await runTurn({
      conversation,
      userMessage: parsed.data.message,
      provider: getProvider(),
      model: agentModel(),
      reasoningEffort: agentReasoningEffort(),
    });
  } catch (error) {
    if (isDomainError(error)) return Response.json({ ok: false, error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ConversationConflictError) {
      return Response.json({ ok: false, error: error.message }, { status: 409 });
    }
    throw error;
  }

  if (result.stopReason === "PROVIDER_CONFIGURATION") {
    return Response.json(
      {
        ok: false,
        error: result.configurationError,
        configuration: true,
        trace: result.trace,
      },
      { status: 503 },
    );
  }

  const auditEvents = await prisma.auditEvent.findMany({
    where: { sessionId: conversation.sessionId },
    orderBy: { createdAt: "asc" },
    select: { action: true, createdAt: true },
  });

  return Response.json({
    ok: true,
    message: result.assistantMessage,
    state: result.state,
    stopReason: result.stopReason,
    trace: result.trace,
    holdActive: Boolean(conversation.activeHoldId),
    auditEvents,
  });
}
