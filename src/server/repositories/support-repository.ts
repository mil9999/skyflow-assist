import type { DatabaseClient } from "../db/prisma";

export interface CreateSupportCaseInput {
  sessionId: string;
  reason: string;
  escalatedFromState: string;
}

export function create(db: DatabaseClient, input: CreateSupportCaseInput) {
  return db.supportCase.create({ data: { ...input, status: "OPEN" } });
}

export function findBySession(db: DatabaseClient, sessionId: string) {
  return db.supportCase.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
}
