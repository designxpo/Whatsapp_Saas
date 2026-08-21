"use client";

// Affiliates — who's referring paying customers, and what's owed.
//
// One SQL aggregate (owner_affiliate_stats()) drives the whole list, so this
// costs the same at 5 affiliates and at 5,000. Row click opens a drawer with
// that affiliate's full referred-tenant list and commission ledger.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Handshake } from "lucide-react";
import { Panel, Table, Th, Td, Spinner, EmptyState, MetricTile, money, compact } from "../_ui";
import { AffiliateDrawer } from "./_drawer";

type AffiliateStat = {
  affiliateId: string; name: string; email: string; code: string; commissionPct: number;
  referredCount: number; convertedCount: number; pendingCents: number; paidCents: number; lifetimeCents: number;
};

export default function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<AffiliateStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/affiliates");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); setAffiliates(null); }
      else { setErr(null); setAffiliates(j.affiliates ?? []); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const totals = (affiliates ?? []).reduce((acc, a) => ({
    referred: acc.referred + a.referredCount, converted: acc.converted + a.convertedCount,
    pending: acc.pending + a.pendingCents, paid: acc.paid + a.paidCents,
  }), { referred: 0, converted: 0, pending: 0, paid: 0 });

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Affiliates</h1>
          <p className="text-sm text-ink-600">Who&apos;s bringing in paying customers, and what&apos;s owed.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60 shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}
      {loading && !affiliates && <div className="flex justify-center py-16"><Spinner /></div>}

      {affiliates && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricTile label="Affiliates" value={compact(affiliates.length)} />
            <MetricTile label="Tenants referred" value={compact(totals.referred)} sub={`${compact(totals.converted)} converted to paid`} />
            <MetricTile label="Pending commission" value={money(totals.pending)} tone={totals.pending > 0 ? "warn" : undefined} />
            <MetricTile label="Paid out" value={money(totals.paid)} />
          </div>

          <Panel dense>
            {!affiliates.length
              ? <EmptyState icon={<Handshake className="w-5 h-5" />} title="No affiliates yet"
                  body="Once someone enrolls at /affiliate and refers a paying tenant, they'll show up here." />
              : (
                <Table head={
                  <tr><Th>Affiliate</Th><Th>Code</Th><Th align="right">Rate</Th><Th align="right">Referred</Th>
                    <Th align="right">Converted</Th><Th align="right">Pending</Th><Th align="right">Paid</Th><Th align="right">Lifetime</Th></tr>
                }>
                  {affiliates.map(a => (
                    <tr key={a.affiliateId} className="hover:bg-canvas cursor-pointer" onClick={() => setOpenId(a.affiliateId)}>
                      <Td><span className="font-bold text-ink-900">{a.name}</span><br /><span className="text-ink-400 text-[11px]">{a.email}</span></Td>
                      <Td><code className="text-[11px] bg-canvas border border-line rounded px-1.5 py-0.5">{a.code}</code></Td>
                      <Td align="right" nums>{a.commissionPct}%</Td>
                      <Td align="right" nums>{compact(a.referredCount)}</Td>
                      <Td align="right" nums>{compact(a.convertedCount)}</Td>
                      <Td align="right" nums className={a.pendingCents > 0 ? "font-bold text-amber-700" : ""}>{money(a.pendingCents)}</Td>
                      <Td align="right" nums>{money(a.paidCents)}</Td>
                      <Td align="right" nums><b>{money(a.lifetimeCents)}</b></Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Panel>
        </>
      )}

      {openId && <AffiliateDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
