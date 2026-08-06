// Relative rather than aliased, so `tsx prisma/seed.ts` can import this too.
import { prisma } from "../db/prisma";

/**
 * The fictional SkyFlow scenario, in one place so `prisma db seed` and the
 * simulator's demo reset can never drift apart.
 *
 * Times are anchored to tomorrow, so the disrupted flight is always in the
 * future no matter when this runs.
 */
export async function resetDemoScenario() {
  const base = new Date(Date.now() + 24 * 60 * 60_000);
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

  await prisma.idempotencyRecord.deleteMany();
  await prisma.supportCase.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.conversationSession.deleteMany();
  await prisma.rebookingHold.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.disruption.deleteMany();
  await prisma.flight.deleteMany();
  await prisma.passenger.deleteMany();

  const emma = await prisma.passenger.create({
    data: { firstName: "Emma", lastName: "Martin", email: "emma.martin@example.invalid" },
  });
  const liam = await prisma.passenger.create({
    data: { firstName: "Liam", lastName: "Okafor", email: "liam.okafor@example.invalid" },
  });
  const sofia = await prisma.passenger.create({
    data: { firstName: "Sofia", lastName: "Rossi", email: "sofia.rossi@example.invalid" },
  });
  const daniel = await prisma.passenger.create({
    data: { firstName: "Daniel", lastName: "Kim", email: "daniel.kim@example.invalid" },
  });
  const aisha = await prisma.passenger.create({
    data: { firstName: "Aisha", lastName: "Bello", email: "aisha.bello@example.invalid" },
  });

  const flight = (spec: {
    flightNumber: string;
    origin: string;
    destination: string;
    departure: number;
    arrival: number;
    availableSeats: number;
    stops?: number;
    connectionVia?: string;
    status?: string;
  }) =>
    prisma.flight.create({
      data: {
        flightNumber: spec.flightNumber,
        origin: spec.origin,
        destination: spec.destination,
        departureTime: at(spec.departure),
        arrivalTime: at(spec.arrival),
        availableSeats: spec.availableSeats,
        stops: spec.stops ?? 0,
        connectionVia: spec.connectionVia,
        status: spec.status ?? "SCHEDULED",
      },
    });

  // Scenario A — LHR to CDG, cancelled, three usable alternatives and a decoy.
  const sf204 = await flight({
    flightNumber: "SF204", origin: "LHR", destination: "CDG",
    departure: 0, arrival: 135, availableSeats: 0, status: "CANCELLED",
  });
  await flight({
    flightNumber: "SF218", origin: "LHR", destination: "CDG",
    departure: 210, arrival: 345, availableSeats: 17,
  });
  await flight({
    flightNumber: "SF224", origin: "LHR", destination: "CDG",
    departure: 480, arrival: 615, availableSeats: 4,
  });
  await flight({
    flightNumber: "SF310", origin: "LHR", destination: "CDG",
    departure: 270, arrival: 550, availableSeats: 9, stops: 1, connectionVia: "AMS",
  });
  await flight({
    flightNumber: "SF228", origin: "LHR", destination: "CDG",
    departure: 700, arrival: 835, availableSeats: 0,
  });

  // Scenario B — LHR to BCN, cancelled, nothing usable behind it.
  const sf640 = await flight({
    flightNumber: "SF640", origin: "LHR", destination: "BCN",
    departure: 0, arrival: 200, availableSeats: 0, status: "CANCELLED",
  });
  await flight({
    flightNumber: "SF644", origin: "LHR", destination: "BCN",
    departure: 400, arrival: 600, availableSeats: 0,
  });
  await flight({
    flightNumber: "SF648", origin: "LHR", destination: "BCN",
    departure: 700, arrival: 900, availableSeats: 12, status: "CANCELLED",
  });

  // Healthy flights.
  const sf120 = await flight({
    flightNumber: "SF120", origin: "LHR", destination: "JFK",
    departure: 60, arrival: 540, availableSeats: 42,
  });
  const sf130 = await flight({
    flightNumber: "SF130", origin: "CDG", destination: "LHR",
    departure: 30, arrival: 95, availableSeats: 30,
  });

  await prisma.disruption.createMany({
    data: [
      { flightId: sf204.id, type: "CANCELLATION", reason: "Aircraft operational issue" },
      { flightId: sf640.id, type: "CANCELLATION", reason: "Crew shortage" },
    ],
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
  await prisma.booking.create({
    data: {
      bookingReference: "SKY73B", passengerId: daniel.id, flightId: sf130.id,
      seatNumber: "3A", status: "ACTIVE",
    },
  });
  await prisma.booking.create({
    data: {
      bookingReference: "SKY41X", passengerId: aisha.id, flightId: sf120.id,
      seatNumber: "19D", status: "ACTIVE",
    },
  });

  return {
    passengers: 5,
    flights: 10,
    disrupted: ["SKY82Q", "SKY55T"],
  };
}
