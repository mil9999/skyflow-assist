import { Conversation, SessionConnectionError, type TextConversation } from "@elevenlabs/client";
import { AGENT_TOOL_NAMES } from "../agent/tool-definitions";
import { getSignedVoiceUrl, VoiceConnectionError } from "../server/voice/elevenlabs";
import { safeProviderStatus } from "../server/voice/provider-status";
import type { EvaluationTransport } from "./voice-runner";
import { EvaluationTransportError } from "./transport-error";

/** Text-only official SDK: no microphone, audio devices, or browser required. */
export class ElevenLabsEvaluationTransport implements EvaluationTransport {
  private conversation?: TextConversation;
  private pending?: { resolve: (reply: string) => void; reject: (error: Error) => void; deadline: ReturnType<typeof setTimeout> };
  private quiet?: ReturnType<typeof setTimeout>;
  private replies: string[] = [];
  private activeTools = 0;
  private replyAfterTools = false;
  private failure?: Error;

  async start(tool: (name: string, args: Record<string, unknown>) => Promise<string>) {
    if (typeof WebSocket === "undefined") throw new Error("Live evaluation requires Node.js 22 or newer with built-in WebSocket support.");
    const greeting = this.waitForReply();
    // Register the waiter first: the initial greeting can arrive during connect.
    void greeting.catch(() => undefined);
    try {
      this.conversation = await Conversation.startSession({
        signedUrl: await getSignedVoiceUrl(), connectionType: "websocket", textOnly: true,
        clientTools: Object.fromEntries(AGENT_TOOL_NAMES.map((name) => [name, async (args: Record<string, unknown>) => {
          this.activeTools++; this.replyAfterTools = false; this.cancelQuiet();
          try { return await tool(name, args); }
          catch { this.fail("A local evaluation tool failed."); throw new Error("Local evaluation tool failed."); }
          finally { this.activeTools--; this.replyAfterTools = false; }
        }])),
        onMessage: ({ role, message }) => {
          if (role !== "agent") return;
          this.replies.push(message);
          this.replyAfterTools = this.activeTools === 0;
          this.scheduleQuiet();
        },
        onError: (message) => this.fail(new EvaluationTransportError("PROVIDER_ERROR", undefined, safeProviderStatus(message))),
        onDisconnect: (details) => {
          if (details.reason === "error") this.fail(new EvaluationTransportError("TRANSPORT_DISCONNECTED", validCloseCode(details.closeCode), safeProviderStatus(details.closeReason)));
          else if (this.pending) {
            if (this.replies.length && this.replyAfterTools && this.activeTools === 0) this.complete();
            else this.fail("The agent disconnected before completing its reply.");
          }
        },
      });
      await greeting;
    } catch (error) {
      const previous = this.failure;
      const closeCode = error instanceof SessionConnectionError ? validCloseCode(error.closeCode) : undefined;
      const status = error instanceof SessionConnectionError ? safeProviderStatus(error.closeReason) : undefined;
      this.fail(previous instanceof EvaluationTransportError
        ? new EvaluationTransportError(previous.reason, closeCode ?? previous.connectionCloseCode, status ?? previous.providerStatus)
        : previous ?? (error instanceof VoiceConnectionError ? error : error instanceof SessionConnectionError
          ? new EvaluationTransportError("CONNECTION_REJECTED", closeCode, status)
          : "Could not start the live ElevenLabs evaluation. Check credentials, agent access, and network connectivity."));
      throw this.failure;
    }
  }

  async exchange(message: string) {
    if (this.failure) throw this.failure;
    if (!this.conversation?.isOpen()) throw new Error("The live conversation is no longer open.");
    const result = this.waitForReply();
    try { this.conversation.sendUserMessage(message); }
    catch { this.fail("The passenger message could not be sent."); }
    return result;
  }

  private waitForReply(): Promise<string> {
    if (this.pending) throw new Error("Evaluation turns must run sequentially.");
    this.replies = []; this.replyAfterTools = false;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, deadline: setTimeout(() => this.fail("No completed agent reply within 45 seconds; this run is inconclusive."), 45_000) };
    });
  }

  private cancelQuiet() { if (this.quiet) clearTimeout(this.quiet); this.quiet = undefined; }
  private scheduleQuiet() {
    this.cancelQuiet();
    // The SDK has no universal turn-complete callback. Require a full agent
    // response after tools settle, then a quiet interval; document this limit.
    if (this.pending && this.replyAfterTools && this.activeTools === 0) this.quiet = setTimeout(() => this.complete(), 2000);
  }
  private complete() {
    const pending = this.pending; if (!pending) return;
    this.pending = undefined; clearTimeout(pending.deadline); this.cancelQuiet();
    pending.resolve(this.replies.join("\n"));
  }
  private fail(message: string | Error) {
    const next = typeof message === "string" ? new Error(message) : message;
    // SDK callbacks can report the same failure before its close details arrive.
    // Preserve the first cause and enrich only with whitelisted diagnostics.
    if (!this.failure) this.failure = next;
    else if (this.failure instanceof EvaluationTransportError && next instanceof EvaluationTransportError) {
      this.failure = new EvaluationTransportError(this.failure.reason, next.connectionCloseCode ?? this.failure.connectionCloseCode, next.providerStatus ?? this.failure.providerStatus);
    }
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.deadline); pending.reject(this.failure); }
    this.cancelQuiet();
  }
  async end() {
    this.cancelQuiet();
    if (this.pending) this.fail("Evaluation ended before a reply completed.");
    await this.conversation?.endSession();
  }
}

function validCloseCode(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 4999 ? value : undefined;
}
