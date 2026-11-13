import { Conversation, type TextConversation } from "@elevenlabs/client";
import { AGENT_TOOL_NAMES } from "../agent/tool-definitions";
import { getSignedVoiceUrl } from "../server/voice/elevenlabs";
import type { EvaluationTransport } from "./voice-runner";

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
        onError: () => this.fail("ElevenLabs reported a conversation error."),
        onDisconnect: ({ reason }) => {
          if (reason === "error") this.fail("ElevenLabs disconnected unexpectedly.");
          else if (this.pending) {
            if (this.replies.length && this.activeTools === 0) this.complete();
            else this.fail("The agent disconnected before completing its reply.");
          }
        },
      });
      await greeting;
    } catch {
      this.fail(this.failure?.message ?? "Could not start the live ElevenLabs evaluation. Check credentials, agent access, and network connectivity.");
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
  private fail(message: string) {
    this.failure = new Error(message);
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
