import { FakeProvider, textResponse } from "./fake-provider";
import { OpenAIProvider } from "./openai-provider";
import type { ModelProvider } from "./provider";

export const DEFAULT_MODEL = "gpt-5.6-luna";

export function agentModel(): string {
  return process.env.TEXT_AGENT_MODEL || DEFAULT_MODEL;
}

export function agentReasoningEffort(): "low" | "medium" | "high" {
  const value = process.env.TEXT_AGENT_REASONING_EFFORT;
  return value === "medium" || value === "high" ? value : "low";
}

/**
 * Set TEXT_AGENT_PROVIDER=fake to click through the simulator UI without
 * spending anything — useful for checking layout and trace rendering.
 */
export function getProvider(): ModelProvider {
  if (process.env.TEXT_AGENT_PROVIDER === "fake") {
    return new FakeProvider([
      textResponse("This is the fake provider. Set TEXT_AGENT_PROVIDER=openai for real replies."),
    ]);
  }
  return new OpenAIProvider();
}
