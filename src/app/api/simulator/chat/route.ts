import { z } from "zod";

import { getConversation } from "@/agent/conversation-store";
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

  const conversation = getConversation(parsed.data.conversationId);
  if (!conversation) {
    return Response.json(
      { ok: false, error: "That conversation has expired. Start a new one." },
      { status: 404 },
    );
  }

  const result = await runTurn({
    conversation,
    userMessage: parsed.data.message,
    provider: getProvider(),
    model: agentModel(),
    reasoningEffort: agentReasoningEffort(),
  });

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
