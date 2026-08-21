"use client";

// Affiliate's own dashboard — referral link, stats, referred tenants, and
// commission ledger. No tenant PII beyond company name/plan is ever shown
// here (see GET /api/affiliate/referrals) — never a referred customer's
// email or phone.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check, LogOut, Handshake } from "lucide-react";

type Stats = {
  affiliateId: string; name: string; email: string; code: string; commissionPct: number;
  referredCount: number; convertedCount: number; pendingCents: number; paidCents: number; lifetimeCents: number;
};
type Referral = { tenantId: string; company: string | null; plan: string; paymentStatus: string; createdAt: string };
type Commission = { id: string; tenantId: string; company: string | null; plan: string; amountCents: number; commissionCents: number; status: "pending" | "paid" | "void"; paidAt: string | null; createdAt: string };

const money = (cents: number) => `₹${Math.round(cents / 100).toLocaleString()}`;
const STATUS_LABEL: Record<string, string> = { active: "Paying", trialing: "On trial", past_due: "Payment failed", cancelled: "Cancelled", none: "No plan" };

export default function AffiliateDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [meRes, refRes] = await Promise.all([fetch("/api/affiliate/me"), fetch("/api/affiliate/referrals")]);
      const [meJson, refJson] = await Promise.all([meRes.json(), refRes.json()]);
      if (!meRes.ok || meJson.error) { setErr(meJson.error || "Couldn't load your account"); return; }
      setStats(meJson.stats);
      setReferrals(refJson.referrals ?? []);
      setCommissions(refJson.commissions ?? []);
    } catch { setErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function logout() {
    await fetch("/api/affiliate/logout", { method: "POST" });
    router.push("/affiliate/login");
    router.refresh();
  }

  const link = stats ? `${typeof window !== "undefined" ? window.location.origin : ""}/signup?ref=${stats.code}` : "";
  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  if (err) return <main className="min-h-screen flex items-center justify-center bg-canvas px-4"><p className="text-sm text-red-600">{err}</p></main>;
  if (!stats) return <main className="min-h-screen flex items-center justify-center bg-canvas"><Loader2 className="w-5 h-5 animate-spin text-ink-400" /></main>;

  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center"><Handshake className="w-4.5 h-4.5 text-white" /></span>
            <div>
              <h1 className="text-lg font-extrabold text-ink-900">{stats.name}</h1>
              <p className="text-xs text-ink-400">{stats.email}</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </header>

        <div className="bg-white rounded-card border border-line p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">Your referral link</p>
            <p className="text-sm text-ink-900 truncate font-mono">{link}</p>
          </div>
          <button onClick={copyLink} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Referred" value={String(stats.referredCount)} />
          <Tile label="Converted to paid" value={String(stats.convertedCount)} />
          <Tile label="Pending commission" value={money(stats.pendingCents)} highlight={stats.pendingCents > 0} />
          <Tile label="Paid out" value={money(stats.paidCents)} />
        </div>

        <div className="bg-white rounded-card border border-line overflow-hidden">
          <header className="px-4 py-3 border-b border-line"><h2 className="text-[13px] font-extrabold text-ink-900">Referred businesses</h2></header>
          {!referrals.length ? (
            <p className="text-sm text-ink-600 p-4">Nobody has signed up through your link yet — share it to get started.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-canvas"><tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase">Business</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase">Plan</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {referrals.map(r => (
                    <tr key={r.tenantId}>
                      <td className="px-3 py-2.5">{r.company || "—"}</td>
                      <td className="px-3 py-2.5">{r.plan}</td>
                      <td className="px-3 py-2.5">{STATUS_LABEL[r.paymentStatus] ?? r.paymentStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-card border border-line overflow-hidden">
          <header className="px-4 py-3 border-b border-line"><h2 className="text-[13px] font-extrabold text-ink-900">Commission history</h2></header>
          {!commissions.length ? (
            <p className="text-sm text-ink-600 p-4">Commission appears here once a referred business makes its first subscription payment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-canvas"><tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase">Business</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-ink-400 uppercase">Commission</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-ink-400 uppercase">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {commissions.map(c => (
                    <tr key={c.id}>
                      <td className="px-3 py-2.5">{c.company || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-bold">{money(c.commissionCents)}</td>
                      <td className="px-3 py-2.5 capitalize">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-white rounded-card border border-line px-4 py-3">
      <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums mt-0.5 ${highlight ? "text-amber-600" : "text-ink-900"}`}>{value}</p>
    </div>
  );
}
