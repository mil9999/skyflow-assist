import { z } from "zod";
import { isDomainError } from "@/domain/errors";
import { prisma } from "@/server/db/prisma";
import { localDemoGuard, privateResponse } from "@/server/http/local-demo";
import { appendEntry } from "@/server/services/conversation-log";
export const runtime = "nodejs";
const schema = z.object({ conversationId: z.string().max(100), messageId: z.string().min(1).max(200), role: z.enum(["user", "agent"]), content: z.string().trim().min(1).max(4000) }).strict();
export async function POST(request: Request) {
  const denied = localDemoGuard(request); if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateResponse({ ok: false, error: "Invalid transcript message." }, 400);
  const body = parsed.data;
  const conversation = await prisma.voiceConversation.findUnique({ where: { id: body.conversationId }, include: { session: { select: { controller: true } } } });
  if (!conversation) return privateResponse({ ok: false, error: "Conversation not found." }, 404);
  try {
    return await prisma.$transaction(async (tx) => {
      const session = await tx.conversationSession.findUniqueOrThrow({ where: { id: conversation.sessionId } });
      if (session.controller === "EMPLOYEE" && body.role === "agent") return privateResponse({ ok: true, ignored: true });
      await appendEntry(tx, conversation.sessionId, `voice:${body.messageId}`, body.role === "user" ? "USER" : "ASSISTANT", body.content, true);
      return privateResponse({ ok: true });
    });
  } catch (error) { return privateResponse({ ok: false, error: isDomainError(error) ? error.message : "Transcript could not be saved." }, 409); }
}
