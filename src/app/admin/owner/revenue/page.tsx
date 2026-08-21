"use client";

// Revenue — the pillar the old portal didn't have at all.
//
// It showed a tenant count, an MRR figure and a signup sparkline. None of that
// answers the questions an owner actually asks weekly: is revenue growing, do
// trials convert, where is it leaking, and which plan is carrying the business.
//
// Every figure is a SQL aggregate, so this page costs the same at 5 tenants and
// at 100k.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { MetricTile, Panel, Table, Th, Td, Spinner, EmptyState, money, compact } from "../_ui";

type Payload = {
  stats: { total: number; active: number; trialing: number; suspended: number; mrrCents: number };
  planMix: { plan: string; count: number }[];
  signupsByDay: { date: string; count: number }[];
  revenueByPlan: { plan: string; tenants: number; mrrCents: number }[];
  funnel: { signups: number; trialing: number; paid: number; lapsed: number };
  churn: { pastDue: number; cancelled: number; trialLapsed: number };
  gatewayFees: { chargedCents: number; feesCents: number; netCents: number };
  arpuCents: number;
  error?: string;
};

export default function RevenuePage() {
  const router = useRouter();
  const [d, setD] = useState<Payload | null>(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/owner/metrics?days=${days}`);
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); setD(null); }
      else { setErr(null); setD(j); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const conv = d && d.funnel.signups > 0 ? Math.round((d.funnel.paid / d.funnel.signups) * 100) : 0;
  const totalChurnRisk = d ? d.churn.pastDue + d.churn.trialLapsed : 0;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Revenue</h1>
          <p className="text-sm text-ink-600">Where the money is, and where it&apos;s leaking.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900">
            {[30, 90, 180, 365].map(n => <option key={n} value={n}>Last {n} days</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}
      {loading && !d && <div className="flex justify-center py-16"><Spinner /></div>}

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricTile label="MRR" value={money(d.stats.mrrCents)} sub={`${compact(d.stats.active)} paying`} />
            <MetricTile label="ARPU" value={money(d.arpuCents)} sub="per paying account" />
            <MetricTile label="Trial → paid" value={`${conv}%`} sub={`${compact(d.funnel.paid)} of ${compact(d.funnel.signups)} signups`} />
            <MetricTile label="At risk" value={compact(totalChurnRisk)} tone={totalChurnRisk > 0 ? "warn" : undefined}
              sub="past due + lapsed trials" onClick={() => router.push("/admin/owner/tenants?queue=payment_failed")} />
            <MetricTile label={`Net of gateway fees · ${days}d`} value={money(d.gatewayFees.netCents)}
              sub={d.gatewayFees.chargedCents > 0 ? `${money(d.gatewayFees.feesCents)} in fees on ${money(d.gatewayFees.chargedCents)} charged` : "No charges in this window"} />
          </div>

          <Panel title={`Signups · last ${days} days`}>
            <Sparkline data={d.signupsByDay} />
          </Panel>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Revenue by plan" dense>
              {!d.revenueByPlan.length
                ? <EmptyState title="No paying accounts yet" body="Revenue appears here once a subscription goes active." />
                : (
                  <Table head={<tr><Th>Plan</Th><Th align="right">Paying</Th><Th align="right">MRR</Th><Th align="right">Share</Th></tr>}>
                    {d.revenueByPlan.map(p => {
                      const share = d.stats.mrrCents > 0 ? Math.round((p.mrrCents / d.stats.mrrCents) * 100) : 0;
                      return (
                        <tr key={p.plan} className="hover:bg-canvas">
                          <Td><span className="font-bold text-ink-900">{p.plan}</span></Td>
                          <Td align="right" nums>{compact(p.tenants)}</Td>
                          <Td align="right" nums><b>{money(p.mrrCents)}</b></Td>
                          <Td align="right" nums>
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-canvas overflow-hidden">
                                <div className="h-full rounded-full bg-brand-600" style={{ width: `${share}%` }} />
                              </div>
                              <span className="text-ink-600 w-8 text-right">{share}%</span>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </Table>
                )}
            </Panel>

            <div className="space-y-4">
              <Panel title="Lifecycle">
                <div className="space-y-2.5">
                  <FunnelBar label="Signed up" value={d.funnel.signups} max={d.funnel.signups} tone="bg-ink-950" />
                  <FunnelBar label="On trial" value={d.funnel.trialing} max={d.funnel.signups} tone="bg-brand-500" />
                  <FunnelBar label="Paying" value={d.funnel.paid} max={d.funnel.signups} tone="bg-emerald-500" />
                  <FunnelBar label="Lapsed" value={d.funnel.lapsed} max={d.funnel.signups} tone="bg-red-400" />
                </div>
                <p className="text-[11px] text-ink-400 mt-3 leading-snug">
                  A snapshot of where accounts stand today, not a cohort — an account that signed up last year and pays now counts in both rows.
                </p>
              </Panel>

              <Panel title="Where it's leaking">
                <div className="grid grid-cols-3 gap-2">
                  <Leak label="Past due" value={d.churn.pastDue} onClick={() => router.push("/admin/owner/tenants?queue=payment_failed")} />
                  <Leak label="Trial lapsed" value={d.churn.trialLapsed} onClick={() => router.push("/admin/owner/tenants?queue=trial_expired")} />
                  <Leak label="Cancelled" value={d.churn.cancelled} onClick={() => router.push("/admin/owner/tenants?status=cancelled")} />
                </div>
              </Panel>
            </div>
          </div>

          <Panel title="Plan mix (all accounts)" dense>
            <div className="flex flex-wrap gap-x-5 gap-y-1 p-4 text-[12px] text-ink-600">
              {d.planMix.map(p => (
                <button key={p.plan} onClick={() => router.push(`/admin/owner/tenants?plan=${p.plan}`)} className="hover:text-brand-700">
                  {p.plan}: <b className="text-ink-900 tabular-nums">{compact(p.count)}</b>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function FunnelBar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-1">
        <span className="text-ink-600">{label}</span>
        <span className="tabular-nums text-ink-900 font-bold">{compact(value)} <span className="text-ink-400 font-normal">{pct}%</span></span>
      </div>
      <div className="h-2 rounded-full bg-canvas overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Leak({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={!value}
      className={`rounded-control border border-line px-3 py-2.5 text-left ${value ? "hover:border-brand-500" : "opacity-60"}`}>
      <p className={`text-lg font-extrabold tabular-nums ${value ? "text-red-600" : "text-ink-900"}`}>{compact(value)}</p>
      <p className="text-[11px] text-ink-600">{label}</p>
    </button>
  );
}

/** Inline bar chart — no chart library in this codebase, and one bar per day is enough. */
function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) return <p className="text-[13px] text-ink-600">No signups in this window.</p>;
  const max = Math.max(...data.map(d => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-24" role="img" aria-label={`${total} signups over ${data.length} days`}>
        {data.map(d => (
          <div key={d.date} title={`${d.date}: ${d.count}`}
            className="flex-1 min-w-[2px] bg-brand-500 hover:bg-brand-700 rounded-t transition-colors"
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-ink-400 mt-1.5 tabular-nums">
        <span>{data[0]?.date}</span>
        <span>{compact(total)} total · peak {max}/day</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
