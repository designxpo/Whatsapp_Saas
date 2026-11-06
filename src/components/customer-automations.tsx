"use client";

// What's running for this customer — journeys, a chatbot flow, AI follow-ups,
// review requests, payment reminders — with what happens next and when, why
// anything stopped, and a Stop button for each (automations.ts).

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Square, Zap } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";

type State = "running" | "waiting" | "stopped" | "finished" | "off";
type Automation = {
  key: string; kind: string; title: string; state: State; next: { at: string | null; what: string } | null;
  why: string; canStop: boolean; stoppedAt?: string | null; stoppedBy?: string | null;
};

const STATE: Record<State, { label: string; cls: string }> = {
  running: { label: "Running", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  waiting: { label: "Waiting", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  stopped: { label: "Stopped", cls: "bg-canvas text-ink-600 border-line" },
  finished: { label: "Finished", cls: "bg-canvas text-ink-600 border-line" },
  off: { label: "Off", cls: "bg-canvas text-ink-400 border-line" },
};

function when(iso: string): string {
  const t = Date.parse(iso);
  const mins = Math.round((t - Date.now()) / 60_000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins} min`;
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? `at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function CustomerAutomations({ conversationId }: { conversationId: string }) {
  const ask = useConfirm();
  const [list, setList] = useState<Automation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/customer-automations?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setList(j.automations); setErr(null);
    } catch (e) { setList([]); setErr(e instanceof Error ? e.message : String(e)); }
  }, [conversationId]);
  useEffect(() => { setList(null); setShowAll(false); void load(); }, [load]);

  async function stop(a: Automation) {
    const ok = await ask({ title: `Stop ${a.title.toLowerCase().startsWith("journey") ? "this journey" : a.title}?`, tone: "danger", confirmLabel: "Stop it",
      message: a.kind === "ai_followup" ? "The AI won't follow up in this chat until the customer writes again." : "Nothing more is sent from it to this customer. This can't be undone from here." });
    if (!ok) return;
    setBusy(a.key); setErr(null);
    const r = await fetch("/api/admin/customer-automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, key: a.key }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || "Couldn't stop it."); else await load();
    setBusy(null);
  }

  const live = (list ?? []).filter(a => a.state === "running" || a.state === "waiting");
  const rest = (list ?? []).filter(a => !(a.state === "running" || a.state === "waiting"));
  const shown = showAll ? [...live, ...rest] : live;

  return (
    <div>
      <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-0.5 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Automations</p>
      <p className="text-[11px] text-ink-400 mb-2">What runs for this customer, and what happens next.</p>
      {list === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : (
        <>
          {!shown.length && <p className="text-[11px] text-ink-500 mb-1">Nothing is running for this customer.</p>}
          <ul className="space-y-1.5">
            {shown.map(a => (
              <li key={a.key} className="rounded-control border border-line bg-white px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[12.5px] font-semibold text-ink-900 break-words">{a.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[12px] font-bold ${STATE[a.state].cls}`}>{STATE[a.state].label}</span>
                    </div>
                    {a.next && <p className="text-[11.5px] text-ink-800">Next: {a.next.what}{a.next.at ? ` — ${when(a.next.at)}` : ""}</p>}
                    <p className="text-[11px] text-ink-500">{a.why}{a.stoppedAt && a.state === "stopped" ? ` · ${new Date(a.stoppedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</p>
                  </div>
                  {a.canStop && (
                    <button onClick={() => void stop(a)} disabled={busy === a.key} aria-label={`Stop ${a.title}`}
                      className="shrink-0 inline-flex items-center gap-1 min-h-8 rounded-control border border-line px-2 text-[12px] font-bold text-ink-700 hover:bg-canvas disabled:opacity-50">
                      {busy === a.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-2.5 w-2.5" />} Stop
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            <button onClick={() => setShowAll(s => !s)} className="mt-1.5 text-[11px] font-semibold text-brand-700 hover:underline">
              {showAll ? "Hide stopped and finished" : `Show stopped and finished (${rest.length})`}
            </button>
          )}
        </>
      )}
      {err && <p role="alert" className="mt-1 text-[11px] text-red-600">{err}</p>}
    </div>
  );
}
