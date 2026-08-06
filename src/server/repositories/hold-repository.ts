import type { DatabaseClient } from "../db/prisma";

export interface CreateHoldInput {
  bookingId: string;
  newFlightId: string;
  expiresAt: Date;
}

export function create(db: DatabaseClient, input: CreateHoldInput) {
  return db.rebookingHold.create({
    data: { ...input, status: "ACTIVE" },
  });
}

export function findById(db: DatabaseClient, id: string) {
  return db.rebookingHold.findUnique({ where: { id } });
}

export function findActiveByBooking(db: DatabaseClient, bookingId: string) {
  return db.rebookingHold.findFirst({
    where: { bookingId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
}

export function confirm(db: DatabaseClient, id: string) {
  return db.rebookingHold.update({ where: { id }, data: { status: "CONFIRMED" } });
}

export function cancel(db: DatabaseClient, id: string) {
  return db.rebookingHold.update({ where: { id }, data: { status: "CANCELLED" } });
}

export function expire(db: DatabaseClient, id: string) {
  return db.rebookingHold.update({ where: { id }, data: { status: "EXPIRED" } });
}

/** Used by both cancellation and expiry so the two paths cannot drift. */
export function setStatus(db: DatabaseClient, id: string, status: "CANCELLED" | "EXPIRED") {
  return db.rebookingHold.update({ where: { id }, data: { status } });
}

export function findDue(db: DatabaseClient, now: Date = new Date()) {
  return db.rebookingHold.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
  });
}
