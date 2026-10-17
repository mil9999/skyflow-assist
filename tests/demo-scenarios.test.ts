import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../src/app/api/simulator/demo/route";
import { clearConversations } from "../src/agent/conversation-store";
import { prisma } from "../src/server/db/prisma";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => {
  clearConversations();
  await resetDatabase();
  await seedScenario();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("ALLOW_DEMO_RESET", "true");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

const run = async (scenario: string) => {
  const response = await POST(new Request("http://localhost/api/simulator/demo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario }),
  }));
  return { status: response.status, body: await response.json() };
};

describe("scripted demo scenarios", () => {
  it("rebooks through the real tool loop without an API key", async () => {
    const { status, body } = await run("rebook");
    expect(status).toBe(200);
    expect(body.mode).toBe("scripted");
    expect(body.state).toBe("REBOOKED");
    expect(body.holdActive).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sessionId");
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { bookingReference: "SKY82Q" }, include: { flight: true },
    });
    expect(booking.status).toBe("REBOOKED");
    expect(booking.flight.flightNumber).toBe("SF218");
    expect(booking.flight.availableSeats).toBe(16);
    expect(await prisma.auditEvent.count({ where: { action: "REBOOKING_CONFIRMED" } })).toBe(1);
    expect(body.messages.at(-2).content).toBe("Yes, confirm this flight.");
    expect(body.trace.filter((step: { type: string }) => step.type === "TOOL")).toHaveLength(6);
  });

  it("opens a support case when no flights are available", async () => {
    const { body } = await run("no-options");
    expect(body.state).toBe("ESCALATED");
    expect(await prisma.supportCase.findFirstOrThrow()).toMatchObject({
      reason: "NO_ALTERNATIVE_FLIGHTS", status: "OPEN",
    });
    expect(await prisma.booking.count({ where: { status: "REBOOKED" } })).toBe(0);
  });

  it("escalates after two failed checks without loading booking details", async () => {
    const { body } = await run("verification-failed");
    expect(body.state).toBe("ESCALATED");
    expect(await prisma.auditEvent.count({ where: { action: "VERIFICATION_FAILED" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "BOOKING_RETRIEVED" } })).toBe(0);
    expect(JSON.stringify(body)).not.toContain("SF204");
  });

  it("refuses production use without replacing any data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const before = await prisma.flight.count();
    expect((await run("rebook")).status).toBe(403);
    expect(await prisma.flight.count()).toBe(before);
  });

  it("requires explicit demo reset enablement", async () => {
    vi.stubEnv("ALLOW_DEMO_RESET", "false");
    expect((await run("rebook")).status).toBe(403);
  });

  it("rejects unknown scenarios before replacing data", async () => {
    const before = await prisma.flight.count();
    expect((await run("unknown")).status).toBe(400);
    expect(await prisma.flight.count()).toBe(before);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/simulator/demo", {
      method: "POST", body: "not-json",
    }));
    expect(response.status).toBe(400);
  });
});
