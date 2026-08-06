import { POST as startSessionRoute } from "@/app/api/tools/start-session/route";
import { createConversation } from "@/agent/conversation-store";
import { agentModel } from "@/server/llm";

export const runtime = "nodejs";

/**
 * Opens a conversation. Session creation is orchestration, not a decision for
 * the model — so this happens before the agent is involved at all.
 */
export async function POST(): Promise<Response> {
  const startedAt = new Date();

  const response = await startSessionRoute(
    new Request("http://internal/api/tools/start-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.TOOLS_API_KEY ?? "",
      },
      body: JSON.stringify({ channel: "TEXT" }),
    }),
  );

  const body = await response.json();
  if (response.status !== 200) {
    return Response.json(
      { ok: false, error: body?.message ?? "Could not start a session." },
      { status: 500 },
    );
  }

  const conversation = createConversation(body.data.sessionId);

  return Response.json({
    ok: true,
    conversationId: conversation.conversationId,
    state: body.data.state,
    model: agentModel(),
    trace: [
      {
        type: "TOOL",
        name: "start_conversation_session",
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        request: { channel: "TEXT", automatic: true },
        response: { ok: true, state: body.data.state },
        httpStatus: 200,
        stateAfter: body.data.state,
      },
    ],
  });
}
