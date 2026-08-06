import type { DatabaseClient } from "../db/prisma";

export interface CreateIdempotencyInput {
  key: string;
  operation: string;
  sessionId: string;
  requestHash: string;
  responseJson?: string;
}

export function findByKey(db: DatabaseClient, key: string) {
  return db.idempotencyRecord.findUnique({ where: { key } });
}

export function create(db: DatabaseClient, input: CreateIdempotencyInput) {
  return db.idempotencyRecord.create({ data: input });
}
