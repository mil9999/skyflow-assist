/**
 * The seam between our agent orchestration and whichever model vendor we use.
 * Nothing outside src/server/llm may import the OpenAI SDK.
 */

export interface ModelTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

/** Responses API input/output items are passed through opaquely. */
export type ModelItem = Record<string, unknown>;

export interface ModelFunctionCall {
  callId: string;
  name: string;
  /** Raw JSON string exactly as the model produced it. */
  arguments: string;
}

export interface ModelRequest {
  model: string;
  instructions: string;
  input: ModelItem[];
  tools: ModelTool[];
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

export interface ModelResponse {
  id?: string;
  outputText: string;
  /** Every item the model produced, appended verbatim to the next request. */
  output: ModelItem[];
  functionCalls: ModelFunctionCall[];
}

export interface ModelProvider {
  readonly name: string;
  createResponse(request: ModelRequest): Promise<ModelResponse>;
}

/** Surfaced to the UI as a configuration problem rather than a model failure. */
export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}
