import {
  ProviderConfigurationError,
  ProviderRequestError,
  type ModelItem,
  type ModelProvider,
} from "@/server/llm/provider";
import { redact } from "./redact";
import { SYSTEM_PROMPT } from "./system-prompt";
import { AGENT_TOOLS } from "./tool-definitions";
import { executeTool, getSessionState } from "./tool-executor";
import type { SimulatorConversation, TraceStep } from "./types";

export const MAX_STEPS = 6;

export interface RunTurnOptions {
  conversation: SimulatorConversation;
  userMessage: string;
  provider: ModelProvider;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  maxSteps?: number;
  timeoutMs?: number;
}

export type StopReason =
  | "COMPLETED"
  | "STEP_LIMIT"
  | "PROVIDER_CONFIGURATION"
  | "PROVIDER_ERROR";

export interface RunTurnResult {
  assistantMessage: string;
  trace: TraceStep[];
  state: string | null;
  stopReason: StopReason;
  configurationError?: string;
}

const APOLOGY =
  "I'm sorry — I'm having trouble with our booking system right now. Let me bring in a colleague to help you.";

/**
 * One passenger turn: model, tool, model, tool… until the model answers with
 * text or we hit the step ceiling.
 */
export async function runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const { conversation, userMessage, provider, model } = options;
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  const trace: TraceStep[] = [];

  conversation.input.push({ role: "user", content: userMessage });
  conversation.messages.push({
    role: "user",
    content: userMessage,
    at: new Date().toISOString(),
  });

  // Identical repeats within one turn indicate a stuck model, not real progress.
  const attempted = new Set<string>();
  let assistantMessage = "";
  let stopReason: StopReason = "COMPLETED";
  let configurationError: string | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    const modelStartedAt = new Date();
    let response;

    try {
      response = await provider.createResponse({
        model,
        instructions: SYSTEM_PROMPT,
        input: conversation.input,
        tools: AGENT_TOOLS,
        reasoningEffort: options.reasoningEffort,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      const isConfiguration = error instanceof ProviderConfigurationError;
      const isProvider = error instanceof ProviderRequestError;

      trace.push({
        type: "MODEL",
        name: provider.name,
        startedAt: modelStartedAt.toISOString(),
        durationMs: Date.now() - modelStartedAt.getTime(),
        errorCode: isConfiguration ? "PROVIDER_CONFIGURATION" : "PROVIDER_ERROR",
        response: { message: error instanceof Error ? error.message : "Unknown provider error" },
      });

      if (isConfiguration) {
        return {
          assistantMessage: "",
          trace,
          state: await getSessionState(conversation.sessionId),
          stopReason: "PROVIDER_CONFIGURATION",
          configurationError: (error as Error).message,
        };
      }

      await safelyEscalate(conversation, trace, isProvider ? "BACKEND_ERROR" : "BACKEND_ERROR");
      assistantMessage = APOLOGY;
      stopReason = "PROVIDER_ERROR";
      break;
    }

    trace.push({
      type: "MODEL",
      name: model,
      startedAt: modelStartedAt.toISOString(),
      durationMs: Date.now() - modelStartedAt.getTime(),
      request: { model, toolCount: AGENT_TOOLS.length, inputItems: conversation.input.length },
      response: redact({
        outputText: response.outputText,
        toolCalls: response.functionCalls.map((call) => ({
          name: call.name,
          arguments: safeParse(call.arguments),
        })),
      }),
    });

    conversation.previousResponseId = response.id;
    conversation.input.push(...(response.output as ModelItem[]));

    if (response.functionCalls.length === 0) {
      assistantMessage = response.outputText;
      stopReason = "COMPLETED";
      break;
    }

    for (const call of response.functionCalls) {
      const signature = `${call.name}:${call.arguments}`;
      const startedAt = new Date();
      const stateBefore = (await getSessionState(conversation.sessionId)) ?? undefined;

      const result = attempted.has(signature)
        ? {
            ok: false,
            status: 409,
            code: "REPEATED_CALL",
            payload: {
              ok: false,
              code: "REPEATED_CALL",
              message:
                "You already made this exact call in this turn and it did not help. Try something different or hand over to a colleague.",
            },
          }
        : await executeTool(conversation, call.name, call.arguments);

      attempted.add(signature);
      const stateAfter = (await getSessionState(conversation.sessionId)) ?? undefined;

      trace.push({
        type: "TOOL",
        name: call.name,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        request: redact(safeParse(call.arguments)),
        response: redact(result.payload),
        httpStatus: result.status,
        errorCode: result.code,
        stateBefore,
        stateAfter,
      });

      conversation.input.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result.payload),
      });
    }

    if (step === maxSteps - 1) {
      await safelyEscalate(conversation, trace, "BACKEND_ERROR");
      assistantMessage = APOLOGY;
      stopReason = "STEP_LIMIT";
    }
  }

  if (assistantMessage) {
    conversation.messages.push({
      role: "assistant",
      content: assistantMessage,
      at: new Date().toISOString(),
    });
  }

  return {
    assistantMessage,
    trace,
    state: await getSessionState(conversation.sessionId),
    stopReason,
    configurationError,
  };
}

/** Best-effort handover. Never throws — we are already on a failure path. */
async function safelyEscalate(
  conversation: SimulatorConversation,
  trace: TraceStep[],
  reason: string,
): Promise<void> {
  const startedAt = new Date();
  try {
    const result = await executeTool(
      conversation,
      "transfer_to_human_agent",
      JSON.stringify({ reason }),
    );
    trace.push({
      type: "TOOL",
      name: "transfer_to_human_agent",
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      request: { reason, automatic: true },
      response: redact(result.payload),
      httpStatus: result.status,
      errorCode: result.code,
    });
  } catch {
    // Nothing more we can do; the apology still goes out.
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return { unparsed: true };
  }
}
