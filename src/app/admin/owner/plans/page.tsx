"use client";

// Plans & pricing — the plan→feature matrix, plus what a change actually costs.
//
// New here: a change-impact line. Flipping a feature on a plan silently rewrites
// what thousands of live accounts can do, and the old editor gave no hint of how
// many. Now the matrix tells you before you save.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, Loader2, AlertTriangle } from "lucide-react";
import { FEATURE_KEYS, FEATURE_META } from "@/lib/entitlement-registry";
import { Panel, Spinner, Badge, money, compact } from "../_ui";

type Plan = {
  id: string; key: string; name: string; priceCents: number; currency: string; interval: string;
  limits: Record<string, number>; features: Record<string, boolean>; sort: number; active: boolean;
};

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [mix, setMix] = useState<Record<string, number>>({});
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        fetch("/api/owner/plans").then(r => r.json()),
        fetch("/api/owner/metrics?days=30").then(r => r.json()).catch(() => ({ planMix: [] })),
      ]);
      setPlans(p.plans ?? []);
      setMix(Object.fromEntries(((m.planMix ?? []) as { plan: string; count: number }[]).map(x => [x.plan, x.count])));
    } catch { setErr("Couldn't load plans."); setPlans([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!plans) return;
    setMatrix(Object.fromEntries(plans.map(p => [p.key, { ...p.features }])));
  }, [plans]);

  // Which cells differ from what's saved — the impact line counts the accounts
  // sitting on those plans.
  const changes = useMemo(() => {
    if (!plans) return [] as { plan: string; feature: string; to: boolean }[];
    const out: { plan: string; feature: string; to: boolean }[] = [];
    for (const p of plans) {
      for (const k of FEATURE_KEYS) {
        const now = !!matrix[p.key]?.[k];
        if (now !== !!p.features[k]) out.push({ plan: p.key, feature: k, to: now });
      }
    }
    return out;
  }, [plans, matrix]);

  const affected = useMemo(
    () => [...new Set(changes.map(c => c.plan))].reduce((s, k) => s + (mix[k] ?? 0), 0),
    [changes, mix],
  );

  async function save() {
    if (!plans) return;
    setBusy(true); setErr(null);
    try {
      const touched = new Set(changes.map(c => c.plan));
      await Promise.all(plans.filter(p => touched.has(p.key)).map(p =>
        fetch("/api/owner/plans", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...p, features: matrix[p.key] ?? p.features }),
        }).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed"); })));
      await load();
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-extrabold text-brand-dark">Plans &amp; pricing</h1>
        <p className="text-sm text-ink-600">What each tier costs and what it unlocks.</p>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}
      {plans === null && <div className="flex justify-center py-16"><Spinner /></div>}

      {plans && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {plans.map(p => (
              <div key={p.id} className="bg-white rounded-card border border-line px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-extrabold text-ink-900 truncate">{p.name}</p>
                    <p className="text-[11px] text-ink-400 font-mono">{p.key}</p>
                  </div>
                  {!p.active && <Badge tone="muted">hidden</Badge>}
                </div>
                <p className="text-xl font-extrabold text-ink-900 tabular-nums mt-1">
                  {p.priceCents ? money(p.priceCents, p.currency) : "Free"}
                  <span className="text-[11px] font-normal text-ink-400">/{p.interval}</span>
                </p>
                <p className="text-[11px] text-ink-600 mt-1">
                  {compact(mix[p.key] ?? 0)} account{(mix[p.key] ?? 0) === 1 ? "" : "s"} · {money((mix[p.key] ?? 0) * p.priceCents, p.currency)} potential MRR
                </p>
              </div>
            ))}
          </div>

          <Panel title="Feature matrix" dense action={
            <div className="flex items-center gap-2">
              {saved && <span className="text-[11px] font-bold text-emerald-600">Saved</span>}
              {changes.length > 0 && (
                <span className="text-[11px] text-amber-700">
                  {changes.length} change{changes.length === 1 ? "" : "s"} · affects {compact(affected)} account{affected === 1 ? "" : "s"}
                </span>
              )}
              <button onClick={save} disabled={busy || !changes.length}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            </div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-canvas">
                  <tr>
                    <th className="sticky left-0 bg-canvas px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em] min-w-[220px]">Feature</th>
                    {plans.map(p => (
                      <th key={p.key} className="px-3 py-2 text-center text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em] whitespace-nowrap">
                        {p.name}
                        <span className="block font-normal normal-case tabular-nums text-ink-400">{compact(mix[p.key] ?? 0)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {FEATURE_KEYS.map(k => (
                    <tr key={k} className="hover:bg-canvas">
                      <td className="sticky left-0 bg-white px-3 py-2 text-ink-900">{FEATURE_META[k]?.label ?? k}</td>
                      {plans.map(p => {
                        const on = !!matrix[p.key]?.[k];
                        const changed = on !== !!p.features[k];
                        return (
                          <td key={p.key} className={`px-3 py-2 text-center ${changed ? "bg-amber-50" : ""}`}>
                            <input type="checkbox" checked={on} className="accent-brand-700"
                              aria-label={`${FEATURE_META[k]?.label ?? k} on ${p.name}`}
                              onChange={e => setMatrix(m => ({ ...m, [p.key]: { ...m[p.key], [k]: e.target.checked } }))} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <p className="text-[11px] text-ink-400">
            Changes apply to every account on that plan the next time entitlements resolve. Grandfathered tenants keep every
            feature regardless, and nothing here is enforced at all while the <b>enforce_entitlements</b> flag is off.
          </p>
        </>
      )}
    </div>
  );
}
