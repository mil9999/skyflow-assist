import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as chatRoute } from "../src/app/api/simulator/chat/route";
import { POST as resetDemoRoute } from "../src/app/api/simulator/reset-demo/route";
import { POST as sessionsRoute } from "../src/app/api/simulator/sessions/route";
import { clearConversations } from "../src/agent/conversation-store";
import { prisma } from "../src/server/db/prisma";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => {
  clearConversations();
  await resetDatabase();
  await seedScenario();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const post = async (
  route: (request: Request) => Promise<Response>,
  body?: unknown,
  path = "http://localhost/api/simulator",
) => {
  const response = await route(
    new Request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
};

/* ------------------------------------------------------------------ */

describe("POST /api/simulator/sessions", () => {
  it("opens a conversation and starts the airline session for the model", async () => {
    const response = await sessionsRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversationId).toMatch(/^conv_/);
    expect(body.state).toBe("UNVERIFIED");
    expect(body.trace[0].name).toBe("start_conversation_session");

    // The browser never receives the airline session id.
    expect(JSON.stringify(body)).not.toContain("sessionId");

    const sessions = await prisma.conversationSession.findMany();
    expect(sessions).toHaveLength(1);
  });
});

describe("POST /api/simulator/chat", () => {
  it("rejects an unknown conversation", async () => {
    const result = await post(chatRoute, { conversationId: "conv_nope", message: "hello" });
    expect(result.status).toBe(404);
  });

  it("rejects an empty message", async () => {
    const result = await post(chatRoute, { conversationId: "conv_x", message: "" });
    expect(result.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await chatRoute(
      new Request("http://localhost/api/simulator/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("runs a turn through the configured provider", async () => {
    vi.stubEnv("TEXT_AGENT_PROVIDER", "fake");

    const created = await (await sessionsRoute()).json();
    const result = await post(chatRoute, {
      conversationId: created.conversationId,
      message: "hello",
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.message).toContain("fake provider");
    expect(result.body.state).toBe("UNVERIFIED");
    expect(Array.isArray(result.body.trace)).toBe(true);
  });
});

describe("POST /api/simulator/reset-demo", () => {
  // Vitest loads .env, so each case pins both guards rather than inheriting
  // whatever the developer happens to have switched on locally.
  it("is refused by default", async () => {
    vi.stubEnv("ALLOW_DEMO_RESET", "false");
    const result = await post(resetDemoRoute);
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("ALLOW_DEMO_RESET");
  });

  it("is refused in development unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEMO_RESET", "false");
    const result = await post(resetDemoRoute);
    expect(result.status).toBe(403);
  });

  it("is refused when enabled but not in development", async () => {
    vi.stubEnv("ALLOW_DEMO_RESET", "true");
    vi.stubEnv("NODE_ENV", "production");
    const result = await post(resetDemoRoute);
    expect(result.status).toBe(403);
  });

  it("restores the fictional airline when both guards are satisfied", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEMO_RESET", "true");

    await prisma.booking.updateMany({
      where: { bookingReference: "SKY82Q" },
      data: { status: "REBOOKED" },
    });

    const result = await post(resetDemoRoute);

    expect(result.status).toBe(200);
    const booking = await prisma.booking.findUnique({ where: { bookingReference: "SKY82Q" } });
    expect(booking?.status).toBe("DISRUPTED");
  });
});
