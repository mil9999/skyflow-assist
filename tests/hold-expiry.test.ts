import { execFileSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db/prisma";
import { getDisruptedBooking } from "../src/server/services/booking-service";
import { searchAlternativeFlights } from "../src/server/services/flight-search-service";
import { cancelHold, confirmRebooking, expireDueHolds, expireHold, holdAlternativeFlight } from "../src/server/services/rebooking-service";
import { createSession, verifyPassenger } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => { await resetDatabase(); await seedScenario(); });
afterAll(() => prisma.$disconnect());

async function reserve() {
  const { sessionId } = await createSession();
  await verifyPassenger({ sessionId, bookingReference: "SKY82Q", lastName: "Martin" });
  await getDisruptedBooking({ sessionId });
  const { options } = await searchAlternativeFlights({ sessionId });
  const held = await holdAlternativeFlight({ sessionId, flightId: options[0].flightId });
  return { sessionId, holdId: held.holdId };
}
const seats = async () => (await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).availableSeats;
const makeDue = (holdId: string) => prisma.rebookingHold.update({ where: { id: holdId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

describe("persisted hold expiry", () => {
  it("ignores early expiry without changing the reservation", async () => {
    const { holdId, sessionId } = await reserve();
    expect((await expireHold({ holdId })).seatReleased).toBe(false);
    expect(await expireDueHolds()).toEqual([]);
    expect(await seats()).toBe(16);
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ state: "AWAITING_CONFIRMATION", activeHoldId: holdId });
    expect(await prisma.auditEvent.count({ where: { action: "HOLD_EXPIRED" } })).toBe(0);
  });
  it("restores inventory and options once across repeated expiry deliveries", async () => {
    const { holdId, sessionId } = await reserve();
    await makeDue(holdId);
    expect(await expireDueHolds()).toEqual([holdId]);
    expect(await expireDueHolds()).toEqual([]);
    expect((await expireHold({ holdId })).seatReleased).toBe(false);
    expect(await seats()).toBe(17);
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ state: "OPTIONS_PRESENTED", activeHoldId: null });
    expect(await prisma.auditEvent.count({ where: { action: "HOLD_EXPIRED" } })).toBe(1);
  });
  it("does not return seats belonging to cancelled or confirmed holds", async () => {
    const first = await reserve();
    await cancelHold(first);
    await makeDue(first.holdId);
    expect((await expireHold({ holdId: first.holdId })).seatReleased).toBe(false);
    const second = await holdAlternativeFlight({ sessionId: first.sessionId, flightId: (await prisma.flight.findUniqueOrThrow({ where: { flightNumber: "SF218" } })).id });
    await confirmRebooking({ sessionId: first.sessionId, holdId: second.holdId, confirmed: true, idempotencyKey: "expiry-confirmed" });
    await makeDue(second.holdId);
    expect(await expireDueHolds()).toEqual([]);
    expect((await expireHold({ holdId: second.holdId })).seatReleased).toBe(false);
    expect(await seats()).toBe(16);
    expect(await prisma.booking.findUniqueOrThrow({ where: { bookingReference: "SKY82Q" } })).toMatchObject({ status: "REBOOKED" });
  });
  it("handles two expiry workers without returning the same seat twice", async () => {
    const { holdId } = await reserve();
    await makeDue(holdId);
    const results = await Promise.all([expireDueHolds(), expireDueHolds()]);
    expect(results.flat()).toEqual([holdId]);
    expect(await seats()).toBe(17);
    expect(await prisma.auditEvent.count({ where: { action: "HOLD_EXPIRED" } })).toBe(1);
  });
  it("recovers an abandoned hold in a separate process without conversation memory", async () => {
    const { holdId, sessionId } = await reserve();
    await makeDue(holdId);
    const run = () => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/expire-holds.ts"], { cwd: process.cwd(), env: { ...process.env }, encoding: "utf8" }).trim());
    expect(run()).toEqual({ expiredHolds: 1 });
    expect(await seats()).toBe(17);
    expect(await prisma.conversationSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ state: "OPTIONS_PRESENTED", activeHoldId: null });
    expect(run()).toEqual({ expiredHolds: 0 });
  });
});
