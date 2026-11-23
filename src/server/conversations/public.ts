import { agentModel } from "@/server/llm";
import { prisma } from "@/server/db/prisma";
import { getConversation } from "@/agent/conversation-store";

export async function sessionForConversation(id: string) {
  const stored = id.startsWith("voice_")
    ? await prisma.voiceConversation.findUnique({ where: { id }, select: { sessionId: true } })
    : await prisma.textConversation.findUnique({ where: { id }, select: { sessionId: true } });
  return stored?.sessionId;
}

export async function publicConversation(id: string) {
  const sessionId = await sessionForConversation(id);
  if (!sessionId) return null;
  const session = await prisma.conversationSession.findUniqueOrThrow({
    where: { id: sessionId }, include: { events: { orderBy: { createdAt: "asc" }, select: { action: true, createdAt: true } }, transcript: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500, select: { id: true, role: true, content: true, createdAt: true } } },
  });
  let messages = session.transcript;
  if (!messages.length && id.startsWith("conv_")) {
    const old = await getConversation(id);
    messages = (old?.messages ?? []).map((entry, i) => ({ id: `old:${i}`, role: entry.role === "user" ? "USER" : "ASSISTANT", content: entry.content, createdAt: new Date(entry.at) }));
  }
  const held = session.activeHoldId ? await prisma.rebookingHold.findUnique({ where: { id: session.activeHoldId }, select: { status: true, expiresAt: true } }) : null;
  return { model: agentModel(), provider: process.env.TEXT_AGENT_PROVIDER === "fake" ? "fake" : "openai", state: session.state, controller: session.controller, auditEvents: session.events, holdActive: held?.status === "ACTIVE" && held.expiresAt.getTime() > Date.now(), messages };
}
