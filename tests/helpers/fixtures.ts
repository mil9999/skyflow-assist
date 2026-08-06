import { prisma } from "../../src/server/db/prisma";

/**
 * Times are relative to "tomorrow" so the disrupted flight is always in the
 * future, whenever you happen to run the suite.
 */
export function makeClock() {
  const base = new Date(Date.now() + 24 * 60 * 60_000);
  return { base, at: (minutes: number) => new Date(base.getTime() + minutes * 60_000) };
}

export async function resetDatabase() {
  // Children before parents.
  await prisma.idempotencyRecord.deleteMany();
  await prisma.supportCase.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.conversationSession.deleteMany();
  await prisma.rebookingHold.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.disruption.deleteMany();
  await prisma.flight.deleteMany();
  await prisma.passenger.deleteMany();
}

export interface SeededFlight {
  id: string;
  flightNumber: string;
}

export interface Fixture {
  at: (minutes: number) => Date;
  flights: Record<string, SeededFlight>;
}

export async function seedScenario(): Promise<Fixture> {
  const { at } = makeClock();

  const emma = await prisma.passenger.create({
    data: { firstName: "Emma", lastName: "Martin", email: "emma@example.invalid" },
  });
  const liam = await prisma.passenger.create({
    data: { firstName: "Liam", lastName: "Okafor", email: "liam@example.invalid" },
  });
  const sofia = await prisma.passenger.create({
    data: { firstName: "Sofia", lastName: "Rossi", email: "sofia@example.invalid" },
  });

  const flights: Record<string, SeededFlight> = {};

  const addFlight = async (spec: {
    flightNumber: string;
    origin: string;
    destination: string;
    departure: number;
    arrival: number;
    availableSeats: number;
    stops?: number;
    status?: string;
  }) => {
    const flight = await prisma.flight.create({
      data: {
        flightNumber: spec.flightNumber,
        origin: spec.origin,
        destination: spec.destination,
        departureTime: at(spec.departure),
        arrivalTime: at(spec.arrival),
        availableSeats: spec.availableSeats,
        stops: spec.stops ?? 0,
        status: spec.status ?? "SCHEDULED",
      },
    });
    flights[spec.flightNumber] = flight;
    return flight;
  };

  // Scenario A: LHR -> CDG. Original cancelled, three usable alternatives, one decoy.
  const sf204 = await addFlight({
    flightNumber: "SF204", origin: "LHR", destination: "CDG",
    departure: 0, arrival: 135, availableSeats: 0, status: "CANCELLED",
  });
  await addFlight({
    flightNumber: "SF218", origin: "LHR", destination: "CDG",
    departure: 210, arrival: 345, availableSeats: 17,
  });
  await addFlight({
    flightNumber: "SF224", origin: "LHR", destination: "CDG",
    departure: 480, arrival: 615, availableSeats: 4,
  });
  await addFlight({
    flightNumber: "SF310", origin: "LHR", destination: "CDG",
    departure: 270, arrival: 550, availableSeats: 9, stops: 1,
  });
  await addFlight({
    flightNumber: "SF228", origin: "LHR", destination: "CDG",
    departure: 700, arrival: 835, availableSeats: 0, // decoy: no seats
  });

  // Scenario B: LHR -> BCN. Cancelled, and nothing usable behind it.
  const sf640 = await addFlight({
    flightNumber: "SF640", origin: "LHR", destination: "BCN",
    departure: 0, arrival: 200, availableSeats: 0, status: "CANCELLED",
  });
  await addFlight({
    flightNumber: "SF644", origin: "LHR", destination: "BCN",
    departure: 400, arrival: 600, availableSeats: 0, // full
  });

  // Scenario C: a perfectly healthy booking.
  const sf120 = await addFlight({
    flightNumber: "SF120", origin: "LHR", destination: "JFK",
    departure: 60, arrival: 540, availableSeats: 42,
  });

  await prisma.disruption.create({
    data: { flightId: sf204.id, type: "CANCELLATION", reason: "Aircraft operational issue" },
  });
  await prisma.disruption.create({
    data: { flightId: sf640.id, type: "CANCELLATION", reason: "Crew shortage" },
  });

  await prisma.booking.create({
    data: {
      bookingReference: "SKY82Q", passengerId: emma.id, flightId: sf204.id,
      seatNumber: "14A", status: "DISRUPTED",
    },
  });
  await prisma.booking.create({
    data: {
      bookingReference: "SKY55T", passengerId: liam.id, flightId: sf640.id,
      seatNumber: "22C", status: "DISRUPTED",
    },
  });
  await prisma.booking.create({
    data: {
      bookingReference: "SKY19M", passengerId: sofia.id, flightId: sf120.id,
      seatNumber: "8F", status: "ACTIVE",
    },
  });

  return { at, flights };
}
