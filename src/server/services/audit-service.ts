import type { AuditAction } from "../../domain/constants";
import { prisma, type DatabaseClient } from "../db/prisma";
import * as auditRepository from "../repositories/audit-repository";

/** Always pass the transaction client when inside one, so the trail rolls back with the write. */
export function record(
  db: DatabaseClient,
  sessionId: string,
  action: AuditAction,
  details?: unknown,
) {
  return auditRepository.create(db, { sessionId, action, details });
}

export function getTrail(sessionId: string) {
  return auditRepository.listBySession(prisma, sessionId);
}
