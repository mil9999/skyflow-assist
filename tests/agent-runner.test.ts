import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { clearConversations, createConversation } from "../src/agent/conversation-store";
import { runTurn } from "../src/agent/conversation-runner";
import type { SimulatorConversation } from "../src/agent/types";
import { prisma } from "../src/server/db/prisma";
import {
  FailingProvider,
  FakeProvider,
  textResponse,
  toolResponse,
} from "../src/server/llm/fake-provider";
import { ProviderConfigurationError, ProviderRequestError } from "../src/server/llm/provider";
import { createSession } from "../src/server/services/verification-service";
import { resetDatabase, seedScenario } from "./helpers/fixtures";

beforeEach(async () => {
  clearConversations();
  await resetDatabase();
  await seedScenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newConversation(): Promise<SimulatorConversation> {
  const { sessionId } = await createSession("TEXT");
  return createConversation(sessionId);
}

const run = (
  conversation: SimulatorConversation,
  provider: FakeProvider | FailingProvider,
  userMessage = "hello",
  maxSteps?: number,
) =>
  runTurn({
    conversation,
    userMessage,
    provider,
    model: "test-model",
    maxSteps,
  });

/* ------------------------------------------------------------------ */

describe("the turn loop", () => {
  it("returns a plain text answer without touching any tool", async () => {
    const conversation = await newConversation();
    const provider = new FakeProvider([textResponse("Hello, I'm SkyFlow Assist.")]);

    const result = await run(conversation, provider);

    expect(result.assistantMessage).toBe("Hello, I'm SkyFlow Assist.");
    expect(result.stopReason).toBe("COMPLETED");
    expect(result.trace.filter((step) => step.type === "TOOL")).toHaveLength(0);
    expect(provider.requests).toHaveLength(1);
  });

  it("runs a tool, feeds the result back, then answers", async () => {
    const conversation = await newConversation();
    const provider = new FakeProvider([
      toolResponse("verify_passenger_identity", {
        bookingReference: "SKY82Q",
        lastName: "Martin",
      }),
      textResponse("Thank you, Ms Martin — I can see your booking."),
    ]);

    const result = await run(conversation, provider, "SKY82Q, Martin");

    expect(result.assistantMessage).toContain("Thank you");
    expect(result.state).toBe("VERIFIED");

    const types = result.trace.map((step) => step.type);
    expect(types).toEqual(["MODEL", "TOOL", "MODEL"]);

    // The tool output was handed back to the model.
    const secondRequest = provider.requests[1];
    const outputs = secondRequest.input.filter((item) => item.type === "function_call_output");
    expect(outputs).toHaveLength(1);
  });

  it("records the state transition a tool caused", async () => {
    const conversation = await newConversation();
    const provider = new FakeProvider([
      toolResponse("verify_passenger_identity", {
        bookingReference: "SKY82Q",
        lastName: "Martin",
      }),
      textResponse("Verified."),
    ]);

    const result = await run(conversation, provider);
    const toolStep = result.trace.find((step) => step.type === "TOOL");

    expect(toolStep?.stateBefore).toBe("UNVERIFIED");
    expect(toolStep?.stateAfter).toBe("VERIFIED");
    expect(toolStep?.httpStatus).toBe(200);
  });

  it("stops and hands over when it exceeds the step limit", async () => {
    const conversation = await newConversation();
    const provider = new FakeProvider([
      toolResponse("get_disrupted_booking"),
      toolResponse("get_disrupted_booking"),
    ]);

    const result = await run(conversation, provider, "help", 2);

    expect(result.stopReason).toBe("STEP_LIMIT");
    expect(result.assistantMessage).toContain("colleague");
    expect(result.state).toBe("ESCALATED");
  });

  it("refuses to run the same call twice in one turn", async () => {
    const conversation = await newConversation();
    const args = { bookingReference: "SKY000", lastName: "Nobody" };
    const provider = new FakeProvider([
      toolResponse("verify_passenger_identity", args),
      toolResponse("verify_passenger_identity", args),
      textResponse("Let me try something else."),
    ]);

    const result = await run(conversation, provider);
    const toolSteps = result.trace.filter((step) => step.type === "TOOL");

    expect(toolSteps).toHaveLength(2);
    expect(toolSteps[1].errorCode).toBe("REPEATED_CALL");
  });
});

describe("privacy of the trace", () => {
  it("masks the surname and booking reference", async () => {
    const conversation = await newConversation();
    const provider = new FakeProvider([
      toolResponse("verify_passenger_identity", {
        bookingReference: "SKY82Q",
        lastName: "Martin",
      }),
      textResponse("Verified."),
    ]);

    const result = await run(conversation, provider);
    const serialised = JSON.stringify(result.trace);

    expect(serialised).not.toContain("Martin");
    expect(serialised).not.toContain("SKY82Q");
    expect(serialised).toContain("M*****");
  });
});

describe("provider failures", () => {
  it("reports a missing key as a configuration problem, not a conversation", async () => {
    const conversation = await newConversation();
    const provider = new FailingProvider(
      new ProviderConfigurationError("OPENAI_API_KEY is not set."),
    );

    const result = await run(conversation, provider);

    expect(result.stopReason).toBe("PROVIDER_CONFIGURATION");
    expect(result.configurationError).toContain("OPENAI_API_KEY");
    expect(result.assistantMessage).toBe("");
    expect(result.state).toBe("UNVERIFIED"); // no escalation for a config mistake
  });

  it("apologises and hands over when the provider fails mid-conversation", async () => {
    const conversation = await newConversation();
    const provider = new FailingProvider(new ProviderRequestError("Rate limited.", true));

    const result = await run(conversation, provider);

    expect(result.stopReason).toBe("PROVIDER_ERROR");
    expect(result.assistantMessage).toContain("sorry");
    expect(result.state).toBe("ESCALATED");
  });
});
