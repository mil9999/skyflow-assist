"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface TraceStep {
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

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AuditEvent {
  action: string;
  createdAt: string;
}

const STATE_COLOURS: Record<string, string> = {
  UNVERIFIED: "bg-slate-700 text-slate-200",
  VERIFIED: "bg-sky-500/20 text-sky-300",
  BOOKING_LOADED: "bg-sky-500/20 text-sky-300",
  OPTIONS_PRESENTED: "bg-indigo-500/20 text-indigo-300",
  OPTION_HELD: "bg-amber-500/20 text-amber-300",
  AWAITING_CONFIRMATION: "bg-amber-500/20 text-amber-300",
  REBOOKED: "bg-emerald-500/20 text-emerald-300",
  ESCALATED: "bg-red-500/20 text-red-300",
};

export default function SimulatorPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<string>("—");
  const [holdActive, setHoldActive] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingScenario, setPendingScenario] = useState<"rebook" | "no-options" | "verification-failed" | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void startConversation();
  }, []);

  useEffect(() => {
    const panel = conversationRef.current;
    panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function startConversation() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/simulator/sessions", { method: "POST" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Could not start a conversation.");

      setConversationId(data.conversationId);
      setModel(data.provider === "fake" ? "offline (canned replies)" : data.model);
      setState(data.state);
      setTrace(data.trace ?? []);
      setAuditEvents([]);
      setHoldActive(false);
      setMessages([
        {
          role: "system",
          content: "New conversation started. Say hello, or dive straight in.",
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || !conversationId || busy) return;

    setInput("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/simulator/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = await response.json();

      if (!data.ok) {
        setError(data.error ?? "The turn failed.");
        if (data.trace) setTrace((current) => [...current, ...data.trace]);
        return;
      }

      setMessages((current) => [...current, { role: "assistant", content: data.message }]);
      setTrace((current) => [...current, ...data.trace]);
      setState(data.state ?? "—");
      setHoldActive(data.holdActive);
      setAuditEvents(data.auditEvents ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    if (!confirm("Restore the fictional airline data? This wipes all sessions and rebookings.")) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/simulator/reset-demo", { method: "POST" });
      const data = await response.json();
      if (!data.ok) {
        setError(data.error);
        return;
      }
      await startConversation();
    } finally {
      setBusy(false);
    }
  }

  async function runScriptedDemo(scenario: "rebook" | "no-options" | "verification-failed") {
    setPendingScenario(null);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/simulator/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Could not run the scenario.");
      setConversationId(data.conversationId);
      setModel(data.model);
      setMessages(data.messages);
      setTrace(data.trace);
      setState(data.state);
      setHoldActive(data.holdActive);
      setAuditEvents(data.auditEvents);
      setInput("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not run the scenario.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-sky-400">SkyFlow Assist</p>
            <h1 className="text-xl font-semibold">Text simulator</h1>
            <Link href="/" className="text-sm text-sky-400 hover:underline">Disruption board</Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-400">
              model <code className="text-slate-300">{model || "…"}</code>
            </span>
            <span
              className={`rounded px-2 py-1 text-xs font-medium ${
                STATE_COLOURS[state] ?? "bg-slate-700 text-slate-200"
              }`}
            >
              {state}
            </span>
            {holdActive && (
              <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
                seat held
              </span>
            )}
            <button
              onClick={startConversation}
              disabled={busy}
              className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              New conversation
            </button>
            <button
              onClick={resetDemo}
              disabled={busy}
              className="rounded border border-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-950 disabled:opacity-40"
            >
              Reset demo
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-900 bg-red-950/40 px-6 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="border-b border-slate-800 bg-slate-900/50 px-6 py-4">
        <h2 className="text-sm font-medium">Try a scripted scenario</h2>
        <p className="mt-1 text-xs text-slate-400">
          Scripted replies exercise the real booking tools without AI API calls. Each run restores fictional demo data.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {([
            ["rebook", "Successful rebooking"],
            ["no-options", "No flights available"],
            ["verification-failed", "Failed verification"],
          ] as const).map(([scenario, label]) => (
            <button key={scenario} onClick={() => setPendingScenario(scenario)} disabled={busy}
              className="rounded border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40">
              {label}
            </button>
          ))}
        </div>
        {pendingScenario && (
          <div role="group" aria-label="Confirm demo data reset" className="mt-3 rounded border border-amber-700/50 bg-amber-950/20 p-3 text-sm">
            <p>This will restore the fictional data and clear existing demo conversations.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => runScriptedDemo(pendingScenario)} disabled={busy}
                className="rounded bg-sky-600 px-3 py-2 font-medium hover:bg-sky-500 disabled:opacity-40">Run scenario</button>
              <button onClick={() => setPendingScenario(null)} className="rounded border border-slate-600 px-3 py-2">Cancel</button>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-0 lg:grid-cols-2">
        {/* Conversation */}
        <section className="flex min-h-[70vh] min-w-0 flex-col border-slate-800 lg:border-r">
          <div ref={conversationRef} className="max-h-[65vh] flex-1 space-y-3 overflow-y-auto p-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[80%] rounded-lg bg-sky-600/20 px-4 py-2 text-sm"
                    : message.role === "assistant"
                      ? "mr-auto max-w-[80%] rounded-lg bg-slate-800 px-4 py-2 text-sm"
                      : "mx-auto text-center text-xs text-slate-500"
                }
              >
                {message.content}
              </div>
            ))}
            {busy && <div className="text-xs text-slate-500">thinking…</div>}
          </div>

          <div className="border-t border-slate-800 p-4">
            <div className="mb-2 text-xs text-slate-500">
              Test credentials — booking <code className="text-slate-400">SKY82Q</code>, surname{" "}
              <code className="text-slate-400">Martin</code>. Also try{" "}
              <code className="text-slate-400">SKY55T</code> / Okafor (no flights available).
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={busy || !conversationId}
                placeholder="Type as the passenger…"
                aria-label="Passenger message"
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-600 disabled:opacity-40"
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </section>

        {/* Inspector */}
        <section className="max-h-[85vh] min-w-0 overflow-y-auto p-6">
          <h2 className="text-xs uppercase tracking-wider text-slate-400">Trace</h2>

          <div className="mt-3 space-y-2">
            {trace.length === 0 && <p className="text-sm text-slate-600">Nothing yet.</p>}

            {trace.map((step, index) => {
              const failed = Boolean(step.errorCode) || (step.httpStatus ?? 200) >= 400;
              return (
                <details
                  key={index}
                  className={`rounded border px-3 py-2 text-sm ${
                    step.type === "MODEL"
                      ? "border-slate-800 bg-slate-900/50"
                      : failed
                        ? "border-red-900/60 bg-red-950/30"
                        : "border-emerald-900/60 bg-emerald-950/20"
                  }`}
                >
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        step.type === "MODEL"
                          ? "bg-slate-700 text-slate-200"
                          : failed
                            ? "bg-red-500/20 text-red-300"
                            : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {step.type}
                    </span>
                    <span className="font-mono text-xs">{step.name}</span>
                    <span className="text-xs text-slate-500">{step.durationMs}ms</span>
                    {step.httpStatus && (
                      <span className="text-xs text-slate-500">HTTP {step.httpStatus}</span>
                    )}
                    {step.errorCode && (
                      <span className="text-xs text-red-300">{step.errorCode}</span>
                    )}
                    {step.stateBefore && step.stateAfter && step.stateBefore !== step.stateAfter && (
                      <span className="text-xs text-indigo-300">
                        {step.stateBefore} → {step.stateAfter}
                      </span>
                    )}
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 text-[11px] text-slate-400">
                    {JSON.stringify({ request: step.request, response: step.response }, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>

          <h2 className="mt-6 text-xs uppercase tracking-wider text-slate-400">Audit trail</h2>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {auditEvents.length === 0 && <li className="text-slate-600">Nothing recorded yet.</li>}
            {auditEvents.map((event, index) => (
              <li key={index} className="font-mono">
                {event.action}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
