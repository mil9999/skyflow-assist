/**
 * SkyFlow Airlines - fictional seed data.
 * All passengers, flights and bookings are invented. No real personal data.
 *
 * Run: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DAY = "2026-08-14";
const at = (time: string) => new Date(`${DAY}T${time}:00.000Z`);

async function main() {
  // Order matters because of foreign keys.
  await prisma.auditEvent.deleteMany();
  await prisma.conversationSession.deleteMany();
  await prisma.rebookingHold.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.disruption.deleteMany();
  await prisma.flight.deleteMany();
  await prisma.passenger.deleteMany();

  /* ---------------- Passengers ---------------- */
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

  /* ---------------- Flights ---------------- */
  // Scenario A: LHR -> CDG, original cancelled, three alternatives.
  const sf204 = await prisma.flight.create({
    data: {
      flightNumber: "SF204", origin: "LHR", destination: "CDG",
      departureTime: at("09:30"), arrivalTime: at("11:45"),
      availableSeats: 0, stops: 0, status: "CANCELLED",
    },
  });
  const sf218 = await prisma.flight.create({
    data: {
      flightNumber: "SF218", origin: "LHR", destination: "CDG",
      departureTime: at("13:00"), arrivalTime: at("15:15"),
      availableSeats: 17, stops: 0, status: "SCHEDULED",
    },
  });
  const sf224 = await prisma.flight.create({
    data: {
      flightNumber: "SF224", origin: "LHR", destination: "CDG",
      departureTime: at("17:30"), arrivalTime: at("19:45"),
      availableSeats: 4, stops: 0, status: "SCHEDULED",
    },
  });
  await prisma.flight.create({
    data: {
      flightNumber: "SF310", origin: "LHR", destination: "CDG",
      departureTime: at("14:00"), arrivalTime: at("18:40"),
      availableSeats: 9, stops: 1, connectionVia: "AMS", status: "SCHEDULED",
    },
  });
  // Decoy: right route, zero seats. Must never be offered.
  const sf228 = await prisma.flight.create({
    data: {
      flightNumber: "SF228", origin: "LHR", destination: "CDG",
      departureTime: at("20:15"), arrivalTime: at("22:30"),
      availableSeats: 0, stops: 0, status: "SCHEDULED",
    },
  });

  // Scenario B: LHR -> BCN, cancelled, no usable alternative.
  const sf640 = await prisma.flight.create({
    data: {
      flightNumber: "SF640", origin: "LHR", destination: "BCN",
      departureTime: at("08:00"), arrivalTime: at("11:20"),
      availableSeats: 0, stops: 0, status: "CANCELLED",
    },
  });
  const sf644 = await prisma.flight.create({
    data: {
      flightNumber: "SF644", origin: "LHR", destination: "BCN",
      departureTime: at("15:00"), arrivalTime: at("18:20"),
      availableSeats: 0, stops: 0, status: "SCHEDULED", // full
    },
  });
  const sf648 = await prisma.flight.create({
    data: {
      flightNumber: "SF648", origin: "LHR", destination: "BCN",
      departureTime: at("19:00"), arrivalTime: at("22:20"),
      availableSeats: 12, stops: 0, status: "CANCELLED", // also cancelled
    },
  });

  // Unrelated healthy flights (used by non-disrupted bookings).
  const sf120 = await prisma.flight.create({
    data: {
      flightNumber: "SF120", origin: "LHR", destination: "JFK",
      departureTime: at("10:00"), arrivalTime: at("18:00"),
      availableSeats: 42, stops: 0, status: "SCHEDULED",
    },
  });
  const sf130 = await prisma.flight.create({
    data: {
      flightNumber: "SF130", origin: "CDG", destination: "LHR",
      departureTime: at("07:15"), arrivalTime: at("08:20"),
      availableSeats: 30, stops: 0, status: "SCHEDULED",
    },
  });

  /* ---------------- Disruptions ---------------- */
  await prisma.disruption.createMany({
    data: [
      { flightId: sf204.id, type: "CANCELLATION", reason: "Aircraft operational issue" },
      { flightId: sf640.id, type: "CANCELLATION", reason: "Crew shortage" },
      { flightId: sf648.id, type: "CANCELLATION", reason: "Knock-on cancellation" },
    ],
  });

  /* ---------------- Bookings ---------------- */
  // Scenario A - the primary demo. Also the surname-mismatch test case.
  await prisma.booking.create({
    data: {
      bookingReference: "SKY82Q", passengerId: emma.id, flightId: sf204.id,
      seatNumber: "14A", status: "DISRUPTED",
    },
  });
  // Scenario B - no alternatives, must escalate.
  await prisma.booking.create({
    data: {
      bookingReference: "SKY55T", passengerId: liam.id, flightId: sf640.id,
      seatNumber: "22C", status: "DISRUPTED",
    },
  });
  // Healthy bookings.
  await prisma.booking.create({
    data: { bookingReference: "SKY19M", passengerId: sofia.id, flightId: sf120.id, seatNumber: "8F", status: "ACTIVE" },
  });
  await prisma.booking.create({
    data: { bookingReference: "SKY73B", passengerId: daniel.id, flightId: sf130.id, seatNumber: "3A", status: "ACTIVE" },
  });
  await prisma.booking.create({
    data: { bookingReference: "SKY41X", passengerId: aisha.id, flightId: sf120.id, seatNumber: "19D", status: "ACTIVE" },
  });

  console.log("Seeded SkyFlow Airlines:");
  console.log("  Scenario A  SKY82Q / Martin  -> SF204 cancelled, alternatives SF218, SF310, SF224");
  console.log("  Scenario B  SKY55T / Okafor  -> SF640 cancelled, no eligible alternative");
  console.log("  Scenario C  SKY82Q / Dubois  -> surname mismatch, verification must fail");
  console.log(`  Decoys: ${sf228.flightNumber} (no seats), ${sf644.flightNumber} (full), ${sf648.flightNumber} (cancelled)`);
  console.log(`  Also seeded: ${sf218.flightNumber}, ${sf224.flightNumber}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
