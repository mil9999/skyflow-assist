import type { DatabaseClient } from "../db/prisma";

export function findById(db: DatabaseClient, id: string) {
  return db.flight.findUnique({ where: { id } });
}

export function findRoute(db: DatabaseClient, origin: string, destination: string) {
  return db.flight.findMany({
    where: { origin, destination },
    orderBy: { departureTime: "asc" },
  });
}

/**
 * Conditional decrement. Returns false if someone else took the last seat
 * between the search and this call, so the caller can fail cleanly.
 */
export async function reserveSeat(db: DatabaseClient, flightId: string): Promise<boolean> {
  const { count } = await db.flight.updateMany({
    where: { id: flightId, availableSeats: { gt: 0 } },
    data: { availableSeats: { decrement: 1 } },
  });
  return count === 1;
}

export async function releaseSeat(db: DatabaseClient, flightId: string): Promise<void> {
  await db.flight.update({
    where: { id: flightId },
    data: { availableSeats: { increment: 1 } },
  });
}

export function findDisruption(db: DatabaseClient, flightId: string) {
  return db.disruption.findFirst({
    where: { flightId },
    orderBy: { createdAt: "desc" },
  });
}
