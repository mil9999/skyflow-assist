import type { DatabaseClient } from "../db/prisma";
import type { AuditAction } from "../../domain/constants";

export interface CreateAuditInput {
  sessionId: string;
  action: AuditAction;
  details?: unknown;
}

export function create(db: DatabaseClient, input: CreateAuditInput) {
  return db.auditEvent.create({
    data: {
      sessionId: input.sessionId,
      action: input.action,
      details: input.details === undefined ? null : JSON.stringify(input.details),
    },
  });
}

export function listBySession(db: DatabaseClient, sessionId: string) {
  return db.auditEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
}

export function countByAction(db: DatabaseClient, sessionId: string, action: AuditAction) {
  return db.auditEvent.count({ where: { sessionId, action } });
}
