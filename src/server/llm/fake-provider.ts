import type { ModelProvider, ModelRequest, ModelResponse } from "./provider";

let counter = 0;
const nextCallId = () => `call_fake_${++counter}`;

/** A scripted model reply containing only text. */
export function textResponse(text: string): ModelResponse {
  return {
    id: `resp_fake_${++counter}`,
    outputText: text,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    functionCalls: [],
  };
}

/** A scripted model reply that calls one tool. */
export function toolResponse(name: string, args: Record<string, unknown> = {}): ModelResponse {
  const callId = nextCallId();
  const argumentsJson = JSON.stringify(args);
  return {
    id: `resp_fake_${++counter}`,
    outputText: "",
    output: [{ type: "function_call", call_id: callId, name, arguments: argumentsJson }],
    functionCalls: [{ callId, name, arguments: argumentsJson }],
  };
}

/**
 * Deterministic stand-in for OpenAI. Every automated test uses this, so
 * `npm test` never makes a network call.
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: ModelResponse[]) {}

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) {
      throw new Error("FakeProvider script exhausted — the runner asked for more turns than scripted.");
    }
    return next;
  }
}

/** Always throws, for testing provider-failure handling. */
export class FailingProvider implements ModelProvider {
  readonly name = "failing";

  constructor(private readonly error: Error) {}

  async createResponse(): Promise<ModelResponse> {
    throw this.error;
  }
}
