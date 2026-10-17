"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AGENT_TOOL_NAMES } from "@/agent/tool-definitions";
import type { TraceStep } from "@/agent/types";

interface Message { key: string; role: "user" | "agent"; content: string }
interface Setup { apiKeyConfigured: boolean; agentConfigured: boolean }
interface ToolResponse { ok: boolean; error?: string; result?: unknown; state: string; holdActive: boolean; trace?: TraceStep }

const STATE_LABELS: Record<string, string> = {
  UNVERIFIED: "Awaiting identity check", VERIFIED: "Passenger verified",
  BOOKING_LOADED: "Booking found", OPTIONS_PRESENTED: "Flights available",
  AWAITING_CONFIRMATION: "Awaiting your confirmation", REBOOKED: "Booking changed",
  ESCALATED: "Human assistance requested",
};

export default function VoicePage() {
  return <ConversationProvider><VoiceConsole /></ConversationProvider>;
}

function VoiceConsole() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [airlineActive, setAirlineActive] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [bookingState, setBookingState] = useState("UNVERIFIED");
  const [holdActive, setHoldActive] = useState(false);
  const [input, setInput] = useState("");
  const airlineId = useRef<string | null>(null);
  const ending = useRef<Promise<void> | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  function applyTool(data: ToolResponse) {
    setBookingState(data.state);
    setHoldActive(data.holdActive);
    if (data.trace) setTrace((previous) => [...previous, data.trace!]);
  }

  async function finishAirline() {
    if (ending.current) return ending.current;
    const id = airlineId.current;
    if (!id) return;
    ending.current = (async () => {
      try {
        const response = await fetch("/api/voice/end", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: id }), keepalive: true,
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error ?? "Could not close the booking session.");
        if (airlineId.current === id) {
          airlineId.current = null;
          setAirlineActive(false);
          setHoldActive(data.holdActive);
          setBookingState(data.state);
          if (data.release) applyTool(data.release);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not close the booking session. Try End conversation again.");
      } finally {
        ending.current = null;
      }
    })();
    return ending.current;
  }

  const conversation = useConversation({
    clientTools: Object.fromEntries(AGENT_TOOL_NAMES.map((name) => [name, async (args: Record<string, unknown>) => {
      const id = airlineId.current;
      if (!id) return JSON.stringify({ ok: false, code: "INVALID_STATE", message: "The airline session has ended." });
      try {
        const response = await fetch("/api/voice/tools", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: id, callId: crypto.randomUUID(), name, args }),
        });
        const data: ToolResponse = await response.json();
        if (!data.ok) throw new Error(data.error ?? "The booking tool is unavailable.");
        applyTool(data);
        return JSON.stringify(data.result);
      } catch {
        setError("A booking tool could not be reached. End the conversation and try again.");
        return JSON.stringify({ ok: false, code: "BACKEND_ERROR", message: "The booking system is unavailable. Do not claim a booking was changed or a colleague connected." });
      }
    }])),
    onMessage: ({ role, message, event_id, response_id }) => {
      // Typed messages are added immediately by send(); voice transcripts arrive here.
      if (role === "user" && textOnly) return;
      const key = `${role}:${response_id ?? event_id}`;
      setMessages((previous) => {
        const found = previous.findIndex((item) => item.key === key);
        const next = { key, role, content: message };
        return found < 0 ? [...previous, next] : previous.map((item, index) => index === found ? next : item);
      });
    },
    onDisconnect: () => { void finishAirline(); },
    onError: () => {
      setError("The ElevenLabs connection failed. Check the agent setup and account access, then try again.");
      conversation.endSession();
      void finishAirline();
    },
    onUnhandledClientToolCall: () => {
      setError("The agent called a tool this app does not support. Check the agent configuration.");
      conversation.endSession();
      void finishAirline();
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/voice/status", { signal: controller.signal }).then((response) => response.json()).then((data) => {
      if (!data.ok) throw new Error(data.error);
      setSetup(data);
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load voice setup.");
    });
    const releaseOnLeave = () => {
      const id = airlineId.current;
      if (id) void fetch("/api/voice/end", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: id }), keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", releaseOnLeave);
    return () => {
      controller.abort();
      window.removeEventListener("pagehide", releaseOnLeave);
      releaseOnLeave();
    };
  }, []);

  useEffect(() => {
    const panel = transcript.current;
    panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const connected = conversation.status === "connected";
  const inProgress = busy || conversation.status === "connecting";
  const ready = setup?.apiKeyConfigured && setup.agentConfigured;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      if (!textOnly) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
      const response = await fetch("/api/voice/sessions", { method: "POST" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Could not open a voice session.");
      airlineId.current = data.conversationId;
      setAirlineActive(true);
      setBookingState(data.state);
      setHoldActive(false);
      setMessages([]);
      setTrace([]);
      conversation.startSession({ signedUrl: data.signedUrl, connectionType: "websocket", textOnly });
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "NotAllowedError"
        ? "Microphone access was declined. Allow it in your browser or choose text instead."
        : caught instanceof Error ? caught.message : "Could not start the conversation.");
      await finishAirline();
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    conversation.endSession();
    await finishAirline();
    setBusy(false);
  }

  function send() {
    if (!input.trim() || !connected) return;
    const content = input.trim();
    conversation.sendUserMessage(content);
    setMessages((previous) => [...previous, { key: `typed:${crypto.randomUUID()}`, role: "user", content }]);
    setInput("");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.2em] text-sky-400">SkyFlow Assist</p><h1 className="mt-1 text-xl font-semibold">Voice rebooking</h1></div>
          <nav className="flex gap-5 text-sm text-slate-400"><Link href="/" className="hover:text-white">Disruption board</Link><Link href="/simulator" className="hover:text-white">Text simulator</Link></nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-slate-400">Local demo · fictional passengers · live ElevenLabs agent</p>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-sky-200">{STATE_LABELS[bookingState] ?? bookingState}</span>
        </div>
        {error && <div role="alert" className="mb-5 rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200">{error}</div>}
        {setup && !ready && <div className="mb-5 rounded-xl border border-slate-700 p-4 text-sm text-slate-300">Add {setup.apiKeyConfigured ? "ELEVENLABS_AGENT_ID" : "ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID"} to the local .env, then restart the development server.</div>}
        <div className="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section aria-label="Conversation controls" className="rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-8 text-center">
            <div className={`mx-auto flex h-32 w-32 items-center justify-center rounded-full border border-sky-400/40 bg-gradient-to-br from-sky-400/20 to-indigo-500/20 shadow-[0_0_60px_rgba(56,189,248,0.08)] ${connected && conversation.isSpeaking ? "motion-safe:animate-pulse" : ""}`}>
              <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" className="h-12 w-12 stroke-sky-200" strokeWidth="2.5" strokeLinecap="round"><path d="M24 7a6 6 0 0 0-6 6v11a6 6 0 0 0 12 0V13a6 6 0 0 0-6-6Z"/><path d="M12 22v2a12 12 0 0 0 24 0v-2M24 36v7M17 43h14"/></svg>
            </div>
            <h2 className="mt-6 text-2xl font-medium">{connected ? conversation.isSpeaking ? "SkyFlow is speaking" : textOnly ? "Ready for your message" : "I'm listening" : inProgress ? "Connecting…" : "Let's find your next flight"}</h2>
            <p aria-live="polite" className="mt-2 text-sm capitalize text-slate-400">{conversation.status}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {!airlineActive && !connected ? <button onClick={start} disabled={!ready || inProgress} className="rounded-lg bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40">Start {textOnly ? "text" : "voice"} conversation</button>
                : <button onClick={stop} disabled={inProgress} className="rounded-lg border border-rose-800 bg-rose-950/40 px-5 py-3 text-sm text-rose-200 disabled:opacity-40">End conversation</button>}
              {connected && !textOnly && <button onClick={() => conversation.setMuted(!conversation.isMuted)} className="rounded-lg border border-slate-600 px-4 py-3 text-sm">{conversation.isMuted ? "Unmute microphone" : "Mute microphone"}</button>}
            </div>
            <label className="mt-5 inline-flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={textOnly} disabled={airlineActive || connected || inProgress} onChange={(event) => setTextOnly(event.target.checked)} className="accent-sky-400"/>Use text instead of microphone</label>
            <p className="mt-6 text-xs leading-5 text-slate-500">During live conversations, audio and messages are sent to ElevenLabs and use your account credits. Only fictional demo bookings are available.</p>
            <div className="mt-7 border-t border-slate-800 pt-5 text-left text-sm"><p className="font-medium text-slate-200">Try a demo booking</p><p className="mt-2 text-slate-400"><span className="font-mono text-sky-200">SKY82Q</span> / Martin · replacement flights</p><p className="mt-1 text-slate-400"><span className="font-mono text-sky-200">SKY55T</span> / Okafor · human assistance</p><p className="mt-3 text-xs text-slate-500">Use Reset demo in the text simulator to restore an already changed booking.</p></div>
          </section>
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/30">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><h2 className="text-sm font-medium">Conversation</h2>{holdActive && <span className="text-xs text-amber-300">Seat held · confirmation needed</span>}</div>
            <div ref={transcript} role="log" aria-label="Conversation transcript" className="h-[390px] space-y-4 overflow-y-auto p-5">
              {messages.length === 0 && <div className="flex h-full items-center justify-center text-center text-sm leading-6 text-slate-500"><p>Your conversation will appear here.<br/>Start a call, then give your reference and surname.</p></div>}
              {messages.map((message) => <div key={message.key} className={`w-fit max-w-[90%] rounded-xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "ml-auto bg-sky-900/40" : "bg-slate-800"}`}><p className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{message.role === "user" ? "You" : "SkyFlow"}</p>{message.content}</div>)}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2 border-t border-slate-800 p-4"><input aria-label="Message SkyFlow" value={input} onChange={(event) => { setInput(event.target.value); if (connected) conversation.sendUserActivity(); }} disabled={!connected} placeholder="Or type a message…" maxLength={2000} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none disabled:opacity-40"/><button disabled={!connected || !input.trim()} className="rounded-lg bg-slate-700 px-4 py-2 text-sm disabled:opacity-40">Send</button></form>
          </section>
        </div>
        <section className="mt-6 rounded-2xl border border-slate-800 p-5"><h2 className="text-sm font-medium">Booking activity</h2><p className="mt-1 text-xs text-slate-500">Backend results from this conversation. Human assistance creates a support case; a live employee is not connected.</p><div className="mt-4 space-y-2">{trace.length === 0 && <p className="text-sm text-slate-500">No booking tools called yet.</p>}{trace.map((step, index) => <details key={index} className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs"><summary className="cursor-pointer break-words text-slate-300">{step.name} <span className="ml-2 text-slate-500">HTTP {step.httpStatus} · {STATE_LABELS[step.stateAfter ?? ""] ?? step.stateAfter}</span></summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-slate-400">{JSON.stringify(step.response, null, 2)}</pre></details>)}</div></section>
      </div>
    </main>
  );
}
