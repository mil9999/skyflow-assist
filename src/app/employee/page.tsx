"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmployeeAction } from "@/server/employee/service";

interface QueueItem { preview: string; id: string; passenger: string; reference: string | null; route: string | null; channel: string; state: string; controller: string; waiting: boolean; working: boolean }
interface FlightOption { flightId: string; flightNumber: string; departureTime: string; arrivalTime: string; connections: number; availableSeats: number; additionalCost: number }
interface Detail {
  id: string; state: string; controller: string; channel: string; working: boolean;
  booking: { reference: string; status: string; flight: string; seat: string | null; route: string } | null;
  hold: { id: string; flightNumber: string; departureTime: string; arrivalTime: string; expiresAt: string } | null;
  messages: { id: string; role: string; content: string; createdAt: string }[];
  events: { id: string; action: string; createdAt: string }[];
  supportCases: { id: string; status: string; reason: string }[];
}
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const time = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
const button = "rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-35";

export default function EmployeePage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [options, setOptions] = useState<FlightOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState("");
  const [reference, setReference] = useState("");
  const [surname, setSurname] = useState("");
  const [consentHoldId, setConsentHoldId] = useState<string | null>(null);
  const [direct, setDirect] = useState(false);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/employee/sessions", { cache: "no-store", signal });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error ?? "Could not load the employee queue.");
    if (signal?.aborted) return;
    setQueue(data.sessions);
    if (selected) {
      const result = await (await fetch(`/api/employee/sessions/${encodeURIComponent(selected)}`, { cache: "no-store", signal })).json();
      if (signal?.aborted) return;
      if (!result.ok) throw new Error(result.error ?? "Could not load this conversation.");
      setDetail(result);
    }
  }, [selected]);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => { void refresh(controller.signal).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not refresh."); }); };
    load(); const timer = setInterval(load, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { panel.current?.scrollTo({ top: panel.current.scrollHeight, behavior: "smooth" }); }, [detail?.messages.length]);
  function choose(id: string) { if (busy) return; setSelected(id); setDetail(null); setOptions([]); setConsentHoldId(null); setContent(""); setReference(""); setSurname(""); setError(null); setNotice(null); }
  async function act(action: EmployeeAction) {
    if (!selected || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/employee/sessions/${encodeURIComponent(selected)}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "The action could not be completed.");
      if (action.action === "search") setOptions(data.result.options);
      if (action.action === "hold" || action.action === "release" || action.action === "confirm") setConsentHoldId(null);
      if (action.action === "message") setContent("");
      setNotice(action.action === "confirm" ? "Booking changed after explicit passenger confirmation." : action.action === "message" ? "Message sent to the passenger." : action.action === "takeover" ? "You control this conversation. AI booking actions are blocked." : "Updated.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }
  const human = detail?.controller === "EMPLOYEE";
  const canSearch = human && ["BOOKING_LOADED", "OPTIONS_PRESENTED"].includes(detail?.state ?? "");
  const items = waitingOnly ? queue.filter((item) => item.waiting) : queue;
  return <main className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 px-6 py-5"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-sky-400">SkyFlow Assist</p><h1 className="mt-1 text-xl font-semibold">Employee workspace</h1></div><nav className="flex gap-5 text-sm text-slate-400"><Link href="/">Disruption board</Link><Link href="/simulator">Text simulator</Link><Link href="/voice">Voice</Link></nav></div></header>
    <div className="mx-auto max-w-[1500px] p-4 md:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-400">Local employee demo · fictional passengers · refreshes automatically</p><span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">{queue.filter((item) => item.waiting).length} needing assistance</span></div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</div>}
      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_310px]">
        <aside aria-label="Conversation queue" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"><div className="border-b border-slate-800 p-4"><h2 className="font-medium">Conversations</h2><label className="mt-3 flex gap-2 text-xs text-slate-400"><input type="checkbox" checked={waitingOnly} onChange={(event) => setWaitingOnly(event.target.checked)}/>Needs assistance only</label></div><div className="max-h-[72vh] overflow-y-auto p-2">{!items.length && <p className="p-4 text-sm leading-6 text-slate-500">No conversations yet. Start a passenger journey in the simulator or voice page.</p>}{items.map((item) => <button key={item.id} disabled={busy} onClick={() => choose(item.id)} className={`mb-1 w-full rounded-lg border p-3 text-left ${selected === item.id ? "border-sky-600 bg-sky-950/40" : "border-transparent hover:bg-slate-800/70"}`}><div className="flex justify-between gap-2"><span className="text-sm font-medium">{item.passenger}</span><span className="text-[10px] text-slate-500">{item.channel}</span></div><p className="mt-1 font-mono text-xs text-sky-300">{item.reference ?? "Unverified"} {item.route && <span className="font-sans text-slate-400">· {item.route}</span>}</p><p className="mt-2 truncate text-xs text-slate-500">{item.preview}</p><div className="mt-2 flex flex-wrap gap-2 text-[10px]"><span className={item.controller === "EMPLOYEE" ? "text-emerald-300" : "text-slate-400"}>{item.controller === "EMPLOYEE" ? "Employee controls" : "AI assistant"}</span>{item.waiting && <span className="text-amber-300">Needs assistance</span>}<span className="text-slate-500">{label(item.state)}</span></div></button>)}</div></aside>
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
          {!detail ? <div className="flex min-h-[520px] items-center justify-center p-8 text-center text-sm text-slate-500">{selected ? "Loading conversation…" : "Choose a conversation to see its history and help the passenger."}</div> : <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4"><div><h2 className="font-medium">{detail.booking?.reference ?? "Identity check required"}</h2><p className="mt-1 text-xs text-slate-400">{detail.channel} · {label(detail.state)}{detail.working && " · operation pending"}</p></div><button className={`${button} ${human ? "text-emerald-300" : "bg-sky-500 font-semibold text-slate-950"}`} disabled={busy || (human && detail.state !== "ESCALATED")} onClick={() => { void act({ action: "takeover" }); }}>{human ? detail.state === "ESCALATED" ? "Resume employee review" : "You control this conversation" : "Take over"}</button></div>
            <div ref={panel} role="log" aria-label="Passenger history" className="h-[460px] space-y-3 overflow-y-auto p-4">{!detail.messages.length && <p className="py-12 text-center text-sm text-slate-500">No saved messages yet.</p>}{detail.messages.map((entry) => <div key={entry.id} className={`max-w-[95%] whitespace-pre-wrap rounded-xl p-3 text-sm leading-6 ${entry.role === "USER" ? "bg-sky-950/40" : entry.role === "EMPLOYEE" ? "ml-auto bg-emerald-950/40" : "ml-auto bg-slate-800/70"}`}><p className="mb-1 flex justify-between gap-4 text-[10px] uppercase tracking-wider text-slate-400"><span>{entry.role === "USER" ? "Passenger" : entry.role === "EMPLOYEE" ? "Employee" : entry.role === "SYSTEM" ? "Conversation update" : "SkyFlow"}</span><span>{time(entry.createdAt)} UTC</span></p>{entry.content}</div>)}</div>
            <form onSubmit={(event) => { event.preventDefault(); void act({ action: "message", content, messageId: crypto.randomUUID() }); }} className="flex gap-2 border-t border-slate-800 p-4"><input aria-label="Reply to passenger" value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} disabled={!human || busy} placeholder={human ? "Reply to the passenger…" : "Take over to reply"} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"/><button disabled={!human || busy || !content.trim()} className={`${button} bg-emerald-500 font-semibold text-slate-950`}>Send</button></form></>}
        </section>
        <aside className="space-y-5 lg:col-start-2 xl:col-start-auto">
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><h2 className="font-medium">Booking controls</h2>{!detail ? <p className="mt-3 text-sm text-slate-500">Select a conversation first.</p> : <div className="mt-4 space-y-4">
            {detail.booking && <div className="text-sm"><p className="text-slate-300">{detail.booking.route}</p><p className="mt-1 text-slate-400">{detail.booking.flight} · {label(detail.booking.status)}{detail.booking.seat && ` · seat ${detail.booking.seat}`}</p></div>}
            {detail.state === "UNVERIFIED" && <form onSubmit={(event) => { event.preventDefault(); void act({ action: "verify", bookingReference: reference, lastName: surname }); }} className="space-y-2"><input aria-label="Booking reference" placeholder="Booking reference" value={reference} onChange={(event) => setReference(event.target.value)} disabled={!human || busy} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" maxLength={40}/><input aria-label="Passenger surname" placeholder="Passenger surname" value={surname} onChange={(event) => setSurname(event.target.value)} disabled={!human || busy} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" maxLength={80}/><button disabled={!human || busy || !reference.trim() || !surname.trim()} className={button}>Verify identity</button></form>}
            {detail.state === "VERIFIED" && <button disabled={!human || busy} className={button} onClick={() => { void act({ action: "load" }); }}>Load disrupted booking</button>}
            {canSearch && <div><label className="mb-3 flex gap-2 text-xs text-slate-400"><input type="checkbox" checked={direct} onChange={(event) => setDirect(event.target.checked)}/>Direct flights only</label><button className={button} disabled={busy} onClick={() => { void act({ action: "search", directOnly: direct }); }}>Find alternatives</button></div>}
            {canSearch && options.map((option) => <div key={option.flightId} className="rounded-lg border border-slate-700 p-3 text-sm"><p className="font-medium text-sky-200">{option.flightNumber}</p><p className="mt-1 text-xs leading-5 text-slate-400">{time(option.departureTime)} → {time(option.arrivalTime)} UTC<br/>{option.connections ? `${option.connections} connection` : "Direct"} · {option.availableSeats} seats · no extra charge</p><button disabled={busy} onClick={() => { void act({ action: "hold", flightId: option.flightId }); }} className={`${button} mt-2`}>Hold this flight</button></div>)}
            {detail.hold && <div className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-3 text-sm"><p className="font-medium text-amber-200">Seat held: {detail.hold.flightNumber}</p><p className="mt-2 text-xs leading-5 text-slate-300">Departure {time(detail.hold.departureTime)} UTC<br/>Arrival {time(detail.hold.arrivalTime)} UTC<br/>Hold ends {time(detail.hold.expiresAt)} UTC</p><label className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-200"><input type="checkbox" checked={consentHoldId === detail.hold.id} disabled={!human || busy} onChange={(event) => setConsentHoldId(event.target.checked ? detail.hold!.id : null)} className="mt-1"/>Passenger explicitly confirmed this exact flight after read-back.</label><div className="mt-3 flex flex-wrap gap-2"><button disabled={!human || busy || consentHoldId !== detail.hold.id} className={`${button} bg-emerald-500 font-semibold text-slate-950`} onClick={() => { void act({ action: "confirm", holdId: detail.hold!.id, confirmed: consentHoldId === detail.hold!.id }); }}>Confirm change</button><button disabled={!human || busy} className={button} onClick={() => { void act({ action: "release" }); }}>Release seat</button></div></div>}
            {detail.state === "REBOOKED" && <p className="rounded-lg bg-emerald-950/40 p-3 text-sm text-emerald-300">Booking change completed. A confirmed seat will not be released by disconnect or expiry.</p>}
            {!human && <p className="text-xs leading-5 text-slate-500">Monitor freely. Take over before replying or changing a booking.</p>}
          </div>}</section>
          <section className="rounded-xl border border-slate-800 p-4"><h2 className="font-medium">Support cases</h2>{!detail?.supportCases.length && <p className="mt-3 text-sm text-slate-500">No support case.</p>}{detail?.supportCases.map((item) => <p key={item.id} className="mt-3 text-xs leading-5 text-slate-400">{label(item.reason)} · <span className={item.status === "OPEN" ? "text-amber-300" : "text-emerald-300"}>{label(item.status)}</span></p>)}{human && detail?.supportCases.some((item) => item.status === "OPEN") && <button className={`${button} mt-3`} disabled={busy} onClick={() => { void act({ action: "resolve" }); }}>Mark cases resolved</button>}</section>
          <section className="rounded-xl border border-slate-800 p-4"><h2 className="font-medium">Activity</h2><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{detail?.events.map((event) => <p key={event.id} className="text-xs leading-5 text-slate-400">{label(event.action)}<span className="ml-2 text-slate-600">{time(event.createdAt)} UTC</span></p>)}</div></section>
        </aside>
      </div>
    </div>
  </main>;
}
