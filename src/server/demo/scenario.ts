// Relative rather than aliased, so `tsx prisma/seed.ts` can import this too.
import { prisma } from "../db/prisma";

/**
 * The fictional SkyFlow scenario, in one place so `prisma db seed` and the
 * simulator's demo reset can never drift apart.
 *
 * Anchored to midnight tomorrow rather than "now + 24 hours", so flights land on
 * civilised clock times — 09:30, 13:00 — instead of whatever hour you happened
 * to seed at. A demo where the only option departs at 2:13am is a bad demo.
 */
export async function resetDemoScenario() {
  const now = new Date();
  const base = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
  /** Minutes past midnight, so 570 reads as 09:30. */
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

  // Scenario A — London to Paris, cancelled, three usable alternatives and a decoy.
  const sf204 = await flight({
    flightNumber: "SF204", origin: "LHR", destination: "CDG",
    departure: 570, arrival: 705, availableSeats: 0, status: "CANCELLED", // 09:30 – 11:45
  });
  await flight({
    flightNumber: "SF218", origin: "LHR", destination: "CDG",
    departure: 780, arrival: 915, availableSeats: 17, // 13:00 – 15:15
  });
  await flight({
    flightNumber: "SF224", origin: "LHR", destination: "CDG",
    departure: 1050, arrival: 1185, availableSeats: 4, // 17:30 – 19:45
  });
  await flight({
    flightNumber: "SF310", origin: "LHR", destination: "CDG",
    departure: 840, arrival: 1120, availableSeats: 9, stops: 1, connectionVia: "AMS", // 14:00 – 18:40
  });
  await flight({
    flightNumber: "SF228", origin: "LHR", destination: "CDG",
    departure: 1215, arrival: 1350, availableSeats: 0, // 20:15 – 22:30, no seats
  });

  // Scenario B — London to Barcelona, cancelled, nothing usable behind it.
  const sf640 = await flight({
    flightNumber: "SF640", origin: "LHR", destination: "BCN",
    departure: 480, arrival: 680, availableSeats: 0, status: "CANCELLED", // 08:00 – 11:20
  });
  await flight({
    flightNumber: "SF644", origin: "LHR", destination: "BCN",
    departure: 900, arrival: 1100, availableSeats: 0, // 15:00 – 18:20, full
  });
  await flight({
    flightNumber: "SF648", origin: "LHR", destination: "BCN",
    departure: 1140, arrival: 1340, availableSeats: 12, status: "CANCELLED", // 19:00 – 22:20
  });

  // Healthy flights.
  const sf120 = await flight({
    flightNumber: "SF120", origin: "LHR", destination: "JFK",
    departure: 600, arrival: 1080, availableSeats: 42, // 10:00 – 18:00
  });
  const sf130 = await flight({
    flightNumber: "SF130", origin: "CDG", destination: "LHR",
    departure: 435, arrival: 500, availableSeats: 30, // 07:15 – 08:20
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
