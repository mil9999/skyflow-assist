import type { DatabaseClient } from "../db/prisma";

const withRelations = { passenger: true, flight: true } as const;

export function findByReference(db: DatabaseClient, bookingReference: string) {
  return db.booking.findUnique({
    where: { bookingReference },
    include: withRelations,
  });
}

export function findById(db: DatabaseClient, id: string) {
  return db.booking.findUnique({ where: { id }, include: withRelations });
}

export interface RebookInput {
  bookingId: string;
  newFlightId: string;
  seatNumber: string;
}

export function rebook(db: DatabaseClient, input: RebookInput) {
  return db.booking.update({
    where: { id: input.bookingId },
    data: {
      flightId: input.newFlightId,
      seatNumber: input.seatNumber,
      status: "REBOOKED",
    },
    include: withRelations,
  });
}
