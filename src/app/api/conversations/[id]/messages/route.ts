import { z } from "zod";
import { isDomainError } from "@/domain/errors";
import { sessionForConversation } from "@/server/conversations/public";
import { prisma } from "@/server/db/prisma";
import { localDemoGuard, privateResponse } from "@/server/http/local-demo";
import { appendEntry } from "@/server/services/conversation-log";
export const runtime = "nodejs";
const schema = z.object({ content: z.string().trim().min(1).max(4000), messageId: z.string().min(1).max(100) }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = localDemoGuard(request); if (denied) return denied;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return privateResponse({ ok: false, error: "Invalid passenger message." }, 400);
  const sessionId = await sessionForConversation((await context.params).id);
  if (!sessionId) return privateResponse({ ok: false, error: "Conversation not found." }, 404);
  try {
    return await prisma.$transaction(async (tx) => {
      const session = await tx.conversationSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.controller !== "EMPLOYEE") return privateResponse({ ok: false, error: "An employee has not joined this conversation yet." }, 409);
      await appendEntry(tx, sessionId, `passenger:${body.data.messageId}`, "USER", body.data.content);
      return privateResponse({ ok: true });
    });
  } catch (error) { return privateResponse({ ok: false, error: isDomainError(error) ? error.message : "The message could not be saved." }, 409); }
}
