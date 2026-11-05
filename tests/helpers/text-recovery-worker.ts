// A separate Node process used only against the isolated test database.
import { beginConversationTurn, getConversation } from "../../src/agent/conversation-store";
import { runTurn } from "../../src/agent/conversation-runner";
import { prisma } from "../../src/server/db/prisma";
import { FakeProvider, textResponse, toolResponse } from "../../src/server/llm/fake-provider";

async function main() {
  const [mode, id] = process.argv.slice(2);
  const conversation = await getConversation(id);
  if (!conversation) throw new Error("Missing test conversation.");
  if (mode === "inspect") {
    console.log(JSON.stringify({
      messages: conversation.messages, latestOptions: conversation.latestOptions,
      activeHoldId: conversation.activeHoldId, inputCount: conversation.input.length,
    }));
  } else if (mode === "interrupt") {
    await beginConversationTurn(conversation);
    // Exit without completing the turn to simulate an interrupted process.
    console.log(JSON.stringify({ interrupted: true }));
  } else if (mode === "confirm") {
    const provider = new FakeProvider([
      toolResponse("confirm_flight_rebooking", { confirmed: true }), textResponse("Rebooked."),
    ]);
    const result = await runTurn({
      conversation, userMessage: "Yes, confirm that flight.", provider, model: "test-model",
    });
    console.log(JSON.stringify({
      state: result.state, messageCount: conversation.messages.length,
      inputCount: provider.requests[0].input.length,
    }));
  } else {
    throw new Error("Unknown recovery test mode.");
  }
}

main().catch(() => { process.exitCode = 1; }).finally(() => prisma.$disconnect());
