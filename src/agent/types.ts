import type { ModelItem } from "@/server/llm/provider";

export interface StoredFlightOption {
  optionId: string;
  /** Server-side only. Never shown to the model. */
  flightId: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  connections: number;
  availableSeats: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface TraceStep {
  type: "MODEL" | "TOOL";
  name?: string;
  startedAt: string;
  durationMs: number;
  request?: unknown;
  response?: unknown;
  httpStatus?: number;
  errorCode?: string;
  stateBefore?: string;
  stateAfter?: string;
}

export interface SimulatorConversation {
  conversationId: string;
  /** The airline session. The browser never sees this. */
  sessionId: string;
  previousResponseId?: string;
  /** Running Responses API input list. */
  input: ModelItem[];
  messages: ConversationMessage[];
  latestOptions: StoredFlightOption[];
  activeHoldId?: string;
  confirmationIdempotencyKey?: string;
  createdAt: Date;
}

export interface ToolResult {
  ok: boolean;
  status: number;
  /** What the model sees. Free of internal identifiers. */
  payload: unknown;
  code?: string;
}
