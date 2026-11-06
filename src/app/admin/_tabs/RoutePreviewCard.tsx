"use client";

// "Which persona would answer this?" — type a customer message and see which AI
// persona the live routing would pick, why, and how well each one fits. Nothing
// is sent; it only scores the message (route-preview.ts).

import { useState } from "react";
import { Loader2, Route } from "lucide-react";
import { inp } from "../_shared";

type Preview = { answeredBy: { agentId: string; name: string } | null; switches: boolean; why: string; scores: { agentId: string; name: string; score: number }[]; thresholds: { minSimilarity: number } };

export function RoutePreviewCard({ agents }: { agents: { id: string; name: string }[] }) {
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/ai/route-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, currentAgentId: current || null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRes(j);
    } catch (e2) { setRes(null); setErr(e2 instanceof Error ? e2.message : String(e2)); }
    setBusy(false);
  }

  const top = res?.scores[0]?.score ?? 0;
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3" aria-label="Test which persona answers">
      <div>
        <p className="text-xs font-bold text-ink-900 inline-flex items-center gap-1.5"><Route className="w-3.5 h-3.5" /> Which persona would answer?</p>
        <p className="text-xs text-slate-500 mt-0.5">Type what a customer might write. Nothing is sent — this shows what the live routing would do.</p>
      </div>
      <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
        <input value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} placeholder="e.g. Do you have a table for 4 tonight?" className={`${inp} flex-1`} aria-label="Customer message" />
        <select value={current} onChange={e => setCurrent(e.target.value)} className={inp} aria-label="Persona already in the chat">
          <option value="">New chat</option>
          {agents.map(a => <option key={a.id} value={a.id}>Chat with {a.name}</option>)}
        </select>
        <button disabled={busy || !message.trim()} className="rounded-control bg-brand-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Test
        </button>
      </form>
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
      {res && (
        <div className="space-y-2 rounded-control bg-canvas p-3">
          <p className="text-sm text-ink-900"><b>{res.answeredBy ? res.answeredBy.name : "Your channel's default persona"}</b> {res.switches ? "takes over." : "answers."}</p>
          <p className="text-xs text-ink-600">{res.why}</p>
          {res.scores.length > 0 && (
            <ul className="space-y-1">
              {res.scores.map(s => (
                <li key={s.agentId} className="flex items-center gap-2 text-[11px]">
                  <span className="w-28 shrink-0 truncate text-ink-700">{s.name}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-white" aria-hidden><span className={`block h-1.5 rounded-full ${s.score === top && s.score >= res.thresholds.minSimilarity ? "bg-brand-600" : "bg-slate-300"}`} style={{ width: `${Math.max(2, Math.min(100, s.score * 100))}%` }} /></span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-500">{Math.round(s.score * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
