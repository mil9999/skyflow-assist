/** Safe diagnostic fields only; provider messages can contain signed URLs. */
export class EvaluationTransportError extends Error {
  constructor(public readonly reason: "CONNECTION_REJECTED", public readonly connectionCloseCode?: number) { super(reason); }
}

export function evaluationFailure(error: unknown) {
  if (error instanceof EvaluationTransportError) {
    return { reason: error.reason, ...(error.connectionCloseCode === undefined ? {} : { connectionCloseCode: error.connectionCloseCode }) };
  }
  const known: Record<string, string> = {
    "Live evaluation requires Node.js 22 or newer with built-in WebSocket support.": "UNSUPPORTED_RUNTIME",
    "Could not start the live ElevenLabs evaluation. Check credentials, agent access, and network connectivity.": "CONNECTION_FAILED",
    "No completed agent reply within 45 seconds; this run is inconclusive.": "REPLY_TIMEOUT",
    "ElevenLabs reported a conversation error.": "PROVIDER_ERROR",
    "ElevenLabs disconnected unexpectedly.": "TRANSPORT_DISCONNECTED",
    "The live conversation is no longer open.": "CONVERSATION_CLOSED",
    "The agent disconnected before completing its reply.": "INCOMPLETE_REPLY",
    "A local evaluation tool failed.": "LOCAL_TOOL_FAILED",
    AGENT_CONFIGURATION_UNAVAILABLE: "AGENT_CONFIGURATION_UNAVAILABLE",
    AGENT_CONFIGURATION_INVALID: "AGENT_CONFIGURATION_INVALID",
    AGENT_PROMPT_OUT_OF_SYNC: "AGENT_PROMPT_OUT_OF_SYNC",
    AGENT_TOOLS_OUT_OF_SYNC: "AGENT_TOOLS_OUT_OF_SYNC",
  };
  return { reason: error instanceof Error && Object.hasOwn(known, error.message) ? known[error.message] : "LOCAL_EVALUATION_ERROR" };
}
