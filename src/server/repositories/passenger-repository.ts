import type { DatabaseClient } from "../db/prisma";

export function findById(db: DatabaseClient, id: string) {
  return db.passenger.findUnique({ where: { id } });
}
