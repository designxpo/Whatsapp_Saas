"use client";

// What's running for this customer — journeys, a chatbot flow, AI follow-ups,
// review requests, payment reminders — with what happens next and when, why
// anything stopped, and a Stop button for each (automations.ts).

import { useCallback, useEffect, useState } from "react";
import { Loader2, Square, Zap } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { DetailsSection } from "@/components/details-section";

type State = "running" | "waiting" | "stopped" | "finished" | "off";
type Automation = {
  key: string; kind: string; title: string; state: State; next: { at: string | null; what: string } | null;
  why: string; canStop: boolean; stoppedAt?: string | null; stoppedBy?: string | null;
};

const STATE: Record<State, { label: string; cls: string }> = {
  running: { label: "Running", cls: "text-emerald-700" },
  waiting: { label: "Waiting", cls: "text-blue-700" },
  stopped: { label: "Stopped", cls: "text-ink-500" },
  finished: { label: "Finished", cls: "text-ink-500" },
  off: { label: "Off", cls: "text-ink-500" },
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
    <DetailsSection id="automations" title="Automations" icon={<Zap />} hint="What runs for this customer, and what happens next.">
      {list === null ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none text-ink-300" aria-label="Loading automations" /> : (
        <>
          {!shown.length && <p className="text-[12px] text-ink-500">Nothing is running for this customer.</p>}
          <ul className="space-y-1.5">
            {shown.map(a => (
              <li key={a.key} className="rounded-[8px] border border-line bg-white px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-[13px] font-medium text-ink-900 break-words leading-snug">
                    {a.title} <span className={`text-[12px] font-semibold ${STATE[a.state].cls}`}>· {STATE[a.state].label}</span>
                  </p>
                  {a.canStop && (
                    <button onClick={() => void stop(a)} disabled={busy === a.key} aria-label={`Stop ${a.title}`}
                      className="shrink-0 -my-0.5 inline-flex items-center gap-1 h-11 md:h-6 rounded-[6px] border border-line px-1.5 text-[12px] font-medium text-ink-700 hover:bg-canvas disabled:opacity-50">
                      {busy === a.key ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> : <Square className="h-2.5 w-2.5" aria-hidden />} Stop
                    </button>
                  )}
                </div>
                {a.next && <p className="mt-0.5 text-[12px] text-ink-700">Next: {a.next.what}{a.next.at ? ` — ${when(a.next.at)}` : ""}</p>}
                <p className="text-[12px] text-ink-500">{a.why}{a.stoppedAt && a.state === "stopped" ? ` · ${new Date(a.stoppedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</p>
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            <button onClick={() => setShowAll(s => !s)} className="mt-1 min-h-11 md:min-h-7 text-[12px] font-medium text-brand-700 hover:underline">
              {showAll ? "Hide stopped and finished" : `Show stopped and finished (${rest.length})`}
            </button>
          )}
        </>
      )}
      {err && <p role="alert" className="mt-1 text-[12px] text-red-700">{err}</p>}
    </DetailsSection>
  );
}
