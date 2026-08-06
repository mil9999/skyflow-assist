import {
  ProviderConfigurationError,
  ProviderRequestError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "./provider";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The SDK is imported lazily so the test suite never loads it, and so a missing
 * dependency surfaces as a clear configuration error rather than a build failure.
 */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      throw new ProviderConfigurationError(
        "OPENAI_API_KEY is not set. Add it to .env and restart the dev server.",
      );
    }

    let OpenAI: typeof import("openai").default;
    try {
      ({ default: OpenAI } = await import("openai"));
    } catch {
      throw new ProviderConfigurationError(
        "The 'openai' package is not installed. Run: npm install openai",
      );
    }

    const client = new OpenAI({ apiKey, timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    let response;
    try {
      response = await client.responses.create({
        model: request.model,
        instructions: request.instructions,
        input: request.input as never,
        tools: request.tools as never,
        // Airline operations mutate shared state; they must run one at a time.
        parallel_tool_calls: false,
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        throw new ProviderConfigurationError("The OpenAI API key was rejected.");
      }
      if (status === 429) {
        throw new ProviderRequestError("Rate limited by OpenAI.", true);
      }
      if (status && status >= 500) {
        throw new ProviderRequestError("OpenAI is unavailable.", true);
      }
      const name = error instanceof Error ? error.name : "UnknownError";
      throw new ProviderRequestError(`OpenAI request failed (${name}).`, false);
    }

    // Passed through opaquely: these items go straight back into the next
    // request's input, so their exact SDK shape is not our concern.
    const output = (response.output ?? []) as unknown as Record<string, unknown>[];

    return {
      id: response.id,
      outputText: response.output_text ?? "",
      output,
      functionCalls: output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          callId: String(item.call_id),
          name: String(item.name),
          arguments: typeof item.arguments === "string" ? item.arguments : "{}",
        })),
    };
  }
}
