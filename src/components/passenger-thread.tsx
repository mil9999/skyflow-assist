"use client";

import { useEffect, useRef, useState } from "react";

export interface PublicConversation {
  controller: "AI" | "EMPLOYEE";
  state: string;
  holdActive: boolean;
  messages: { id: string; role: string; content: string; createdAt: string }[];
}

export function useConversationMonitor(id: string | null) {
  const [data, setData] = useState<(PublicConversation & { conversationId: string }) | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (result.ok && !controller.signal.aborted) setData({ ...result, conversationId: id });
      } catch { /* Retain the visible conversation during a brief reconnect. */ }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 1500);
    return () => { controller.abort(); clearInterval(interval); };
  }, [id]);
  return data?.conversationId === id ? data : null;
}

export function PassengerThread({ conversationId, data }: { conversationId: string; data: PublicConversation }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageId = useRef<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollTo({ top: panel.current.scrollHeight, behavior: "smooth" }); }, [data.messages]);
  async function send() {
    if (!content.trim() || busy) return;
    setBusy(true); setError(null);
    messageId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: content.trim(), messageId: messageId.current }),
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error ?? "The message could not be sent.");
      setContent(""); messageId.current = null;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The message could not be sent."); }
    finally { setBusy(false); }
  }
  return <section className="overflow-hidden rounded-xl border border-emerald-700/50 bg-slate-900/70">
    <div className="border-b border-slate-800 p-4"><h2 className="font-medium text-emerald-300">Employee text support</h2><p className="mt-1 text-xs text-slate-400">An employee controls this booking now. Continue here by text.</p></div>
    <div ref={panel} role="log" aria-label="Employee conversation" className="h-[390px] space-y-3 overflow-y-auto p-4">
      {data.messages.map((message) => <div key={message.id} className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6 ${message.role === "USER" ? "ml-auto bg-sky-900/40" : message.role === "EMPLOYEE" ? "bg-emerald-950/50" : "bg-slate-800/70"}`}><p className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{message.role === "USER" ? "You" : message.role === "EMPLOYEE" ? "Employee" : message.role === "SYSTEM" ? "Conversation update" : "SkyFlow"}</p>{message.content}</div>)}
    </div>
    {error && <p role="alert" className="px-4 text-sm text-amber-300">{error}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2 border-t border-slate-800 p-4"><input aria-label="Message employee" value={content} onChange={(event) => { setContent(event.target.value); messageId.current = null; }} maxLength={4000} placeholder="Message the employee…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><button disabled={busy || !content.trim()} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy ? "Sending…" : "Send"}</button></form>
  </section>;
}
