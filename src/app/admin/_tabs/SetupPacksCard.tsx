"use client";

// Industry setup packs — pick your kind of business, see exactly what would be
// added (and what's left alone because you already have it), then add it.
// Admins only; hidden for everyone else (industry-packs.ts).

import { useEffect, useState } from "react";
import { Check, Loader2, Package } from "lucide-react";
import { toast } from "@/components/toast";

type PackInfo = { id: string; label: string; summary: string; notIncluded: string };
type Item = { kind: string; name: string; status: "create" | "skip" | "set" | "keep"; note: string };
type Data = { packs: PackInfo[]; suggested: string | null; applied: { id: string; appliedAt: string } | null; plan: Item[] | null };

const KIND: Record<string, string> = { persona: "AI agent", journey: "Follow-up journey", quick_reply: "Quick reply", review_style: "Review replies", reply_target: "Today", kb_test: "Knowledge check" };

export function SetupPacksCard() {
  const [d, setD] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [plan, setPlan] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/setup-packs").then(async r => {
      if (r.status === 403 || r.status === 401) { setHidden(true); return; }
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setD(j); setPick(j.suggested);
    }).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!pick) { setPlan(null); return; }
    setPlan(null); setResult(null);
    fetch(`/api/admin/setup-packs?pack=${encodeURIComponent(pick)}`).then(r => r.json()).then(j => setPlan(j.plan ?? null)).catch(() => setPlan(null));
  }, [pick]);

  async function apply() {
    if (!pick) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/setup-packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack: pick }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't apply the pack.");
      setResult(`Added ${j.done.length} item${j.done.length === 1 ? "" : "s"}.${j.failed.length ? ` ${j.failed.length} couldn't be added: ${j.failed.map((f: { item: Item; error: string }) => f.item.name).join(", ")}.` : ""} The follow-up journey stays off until you turn it on in Sequences, and new AI agents aren't the default until you choose them in AI Hub.`);
      toast(j.failed.length ? { text: `Added ${j.done.length}, ${j.failed.length} couldn't be added`, tone: "info" } : `Added ${j.done.length} item${j.done.length === 1 ? "" : "s"} from the pack`);
      const again = await fetch(`/api/admin/setup-packs?pack=${encodeURIComponent(pick)}`).then(x => x.json());
      setPlan(again.plan ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  if (hidden || (!d && !err)) return null;
  const pack = d?.packs.find(p => p.id === pick);
  const toAdd = (plan ?? []).filter(i => i.status === "create" || i.status === "set");

  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-4" aria-label="Setup packs">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900"><Package className="h-4 w-4" /> Start from a setup pack</p>
        <p className="text-[12px] text-ink-600">Ready-made AI agents, a follow-up journey, quick replies and checks for your kind of business. You see everything before it&apos;s added, and nothing you already have is changed.</p>
      </div>
      {err && <p role="alert" className="text-[12px] text-red-600">{err}</p>}
      {d && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of business">
          {d.packs.map(p => (
            <button key={p.id} role="radio" aria-checked={pick === p.id} onClick={() => setPick(p.id)}
              className={`min-h-9 rounded-control border px-3 py-1.5 text-xs font-bold ${pick === p.id ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line text-ink-700 hover:bg-canvas"}`}>
              {p.label}{d.suggested === p.id ? " · suggested" : ""}{d.applied?.id === p.id ? " · added" : ""}
            </button>
          ))}
        </div>
      )}
      {pack && (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-700">{pack.summary}</p>
          {plan === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {plan.map((i, n) => (
                <li key={n} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                  <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[11px] font-bold ${i.status === "create" || i.status === "set" ? "bg-emerald-50 text-emerald-700" : "bg-canvas text-ink-500"}`}>
                    {i.status === "create" ? "Add" : i.status === "set" ? "Set" : "Keep yours"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900"><span className="font-normal text-ink-500">{KIND[i.kind] ?? i.kind}:</span> {i.name}</p>
                    <p className="text-ink-500 line-clamp-2">{i.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-ink-500"><b>Not included:</b> {pack.notIncluded}</p>
          {result && <p className="flex items-start gap-1 text-[12px] font-medium text-emerald-700"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {result}</p>}
          <button onClick={() => void apply()} disabled={busy || !toAdd.length} title={!toAdd.length && plan ? "You already have everything in this pack" : undefined}
            className="min-h-10 rounded-control bg-brand-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {toAdd.length ? `Add ${toAdd.length} item${toAdd.length === 1 ? "" : "s"}` : "Everything here is already set up"}
          </button>
        </div>
      )}
    </section>
  );
}
