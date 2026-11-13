import type { DatabaseClient } from "../db/prisma";
import type { ConversationMessage } from "../../agent/types";
import { DomainError, ErrorCode } from "../../domain/errors";

export async function appendTextHistory(db: DatabaseClient, sessionId: string, messages: ConversationMessage[]) {
  const existing = await db.conversationEntry.findMany({ where: { sessionId, sourceId: { startsWith: "text:" } }, select: { sourceId: true } });
  const saved = new Set(existing.map((entry) => entry.sourceId));
  const data = messages.flatMap((message, index) => saved.has(`text:${index}`) ? [] : [{
    sessionId, sourceId: `text:${index}`, role: message.role === "user" ? "USER" : "ASSISTANT",
    content: message.content, createdAt: new Date(message.at),
  }]);
  if (data.length) await db.conversationEntry.createMany({ data });
}

export async function appendEntry(db: DatabaseClient, sessionId: string, sourceId: string, role: string, content: string, replace = false) {
  const existing = await db.conversationEntry.findUnique({ where: { sessionId_sourceId: { sessionId, sourceId } } });
  if (existing) {
    if (existing.role !== role || (!replace && existing.content !== content)) throw new DomainError(ErrorCode.INVALID_STATE, "A message ID cannot be reused for different content.");
    return replace ? db.conversationEntry.update({ where: { id: existing.id }, data: { content } }) : existing;
  }
  if (await db.conversationEntry.count({ where: { sessionId } }) >= 500) throw new DomainError(ErrorCode.INVALID_STATE, "This demo conversation has reached its message limit.");
  return db.conversationEntry.create({ data: { sessionId, sourceId, role, content } });
}
