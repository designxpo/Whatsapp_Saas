"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CreditCard, Check, X, ArrowLeft, ExternalLink } from "lucide-react";
import { FEATURE_KEYS, FEATURE_META } from "@/lib/entitlement-registry";

type Limits = { contacts: number; conversations_per_month?: number; messages_per_month: number; channels: number; team_seats: number };
type PlanRow = { key: string; name: string; priceCents: number; currency: string; interval: string; limits: Limits; features?: Record<string, boolean>; purchasable: boolean };
type Current = { plan: string; paymentStatus: string; amountCents: number; currency: string; trialEndsAt: string | null; currentPeriodEnd: string | null; hasSubscription: boolean; hasCustomer: boolean };

const money = (c: number, cur: string) => `${cur === "INR" ? "₹" : cur + " "}${(c / 100).toLocaleString()}`;
const lim = (n: number) => (n === 0 ? "Unlimited" : n.toLocaleString());
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700", trialing: "bg-amber-50 text-amber-700",
  past_due: "bg-red-50 text-red-700", cancelled: "bg-slate-100 text-slate-600", none: "bg-slate-100 text-slate-600",
};

export default function BillingPage() {
  const router = useRouter();
  const [stripeOn, setStripeOn] = useState(true);
  const [current, setCurrent] = useState<Current | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/admin/billing").then(r => r.json());
      setStripeOn(d.stripeConfigured !== false);
      setCurrent(d.current ?? null);
      setPlans(d.plans ?? []);
    } catch { setMsg("Could not load billing."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s === "success") setBanner("✅ Subscription active — thanks! It may take a few seconds to reflect.");
    if (s === "cancelled") setBanner("Checkout cancelled — no charge was made.");
  }, []);

  async function checkout(planKey: string) {
    setBusy(planKey); setMsg(null);
    try {
      const res = await fetch("/api/admin/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not start checkout"); return; }
      window.location.href = d.url;
    } finally { setBusy(null); }
  }

  // Team-managed billing (no self-serve Stripe): record an upgrade request the
  // owner sees in the Owner Portal and actions there.
  async function requestUpgrade(planKey: string, planName: string) {
    setBusy(planKey); setMsg(null);
    try {
      const res = await fetch("/api/admin/billing/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not send request"); return; }
      setRequested(s => new Set(s).add(planKey));
      setBanner(`✅ Request sent — our team will move you to ${planName} shortly.`);
    } finally { setBusy(null); }
  }

  async function portal() {
    setBusy("portal"); setMsg(null);
    try {
      const res = await fetch("/api/admin/billing/portal", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not open billing portal"); return; }
      window.location.href = d.url;
    } finally { setBusy(null); }
  }

  if (loading) return <div className="min-h-screen grid place-items-center bg-canvas"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <button onClick={() => router.push("/admin")} className="text-xs text-ink-500 flex items-center gap-1.5 hover:text-ink-900"><ArrowLeft className="w-3.5 h-3.5" /> Back to dashboard</button>

        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-700" />
          <h1 className="text-xl font-extrabold text-ink-900">Billing &amp; plan</h1>
        </div>

        {banner && <div className="bg-brand-50 text-brand-800 text-sm rounded-card px-4 py-3">{banner}</div>}
        {msg && <div className="bg-red-50 text-red-700 text-sm rounded-card px-4 py-3">{msg}</div>}
        {!stripeOn && <div className="bg-amber-50 text-amber-800 text-sm rounded-card px-4 py-3">Online payments aren&apos;t enabled yet — billing is managed by our team. Pick a plan below and tap <b>Request</b>; we&apos;ll switch you over and confirm.</div>}

        {/* Current subscription */}
        {current && (
          <div className="bg-white rounded-card border border-line p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Current plan</p>
                <p className="text-lg font-extrabold text-ink-900 capitalize mt-0.5">{current.plan}
                  <span className={`ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full align-middle ${STATUS_STYLE[current.paymentStatus] ?? "bg-slate-100 text-slate-600"}`}>{current.paymentStatus}</span>
                </p>
                <p className="text-xs text-ink-500 mt-1">
                  {current.amountCents > 0 ? `${money(current.amountCents, current.currency)}/mo · ` : ""}
                  {current.paymentStatus === "trialing" ? `Trial ends ${fmtDate(current.trialEndsAt)}` : current.currentPeriodEnd ? `Renews ${fmtDate(current.currentPeriodEnd)}` : ""}
                </p>
              </div>
              {stripeOn && current.hasCustomer && (
                <button onClick={portal} disabled={busy === "portal"} className="px-4 py-2 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas flex items-center gap-1.5">
                  {busy === "portal" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />} Manage billing
                </button>
              )}
            </div>
          </div>
        )}

        {/* Plan grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => {
            const isCurrent = current?.plan === p.key;
            return (
              <div key={p.key} className={`bg-white rounded-card border p-5 flex flex-col ${isCurrent ? "border-brand-700 ring-1 ring-brand-700/20" : "border-line"}`}>
                <p className="text-sm font-extrabold text-ink-900">{p.name}</p>
                <p className="text-2xl font-extrabold text-ink-900 mt-1">{p.priceCents === 0 ? "Free" : money(p.priceCents, p.currency)}<span className="text-xs font-medium text-ink-400">{p.priceCents ? `/${p.interval}` : ""}</span></p>
                <ul className="mt-3 space-y-1.5 text-xs text-ink-600">
                  <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-600 shrink-0" /> {lim(p.limits.contacts)} contacts</li>
                  <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-600 shrink-0" /> {p.limits.conversations_per_month != null ? `${lim(p.limits.conversations_per_month)} conversations/mo` : `${lim(p.limits.messages_per_month)} messages/mo`}</li>
                  <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-600 shrink-0" /> {lim(p.limits.channels)} channel(s)</li>
                  <li className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-brand-600 shrink-0" /> {lim(p.limits.team_seats)} team seats</li>
                </ul>
                {/* Per-plan feature breakdown — included (✓) vs not in this plan (✗). */}
                <div className="mt-3 border-t border-line pt-3 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mb-1.5">Features</p>
                  <ul className="space-y-1">
                    {FEATURE_KEYS.map(k => {
                      const on = p.features?.[k] === true;
                      return (
                        <li key={k} className={`flex items-center gap-1.5 text-[11px] ${on ? "text-ink-600" : "text-ink-300"}`}>
                          {on ? <Check className="w-3 h-3 text-brand-600 shrink-0" /> : <X className="w-3 h-3 shrink-0" />}
                          <span className={on ? "" : "line-through"}>{FEATURE_META[k].label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="mt-4">
                  {isCurrent ? (
                    <span className="block text-center text-xs font-bold text-brand-700 py-2">Your plan</span>
                  ) : stripeOn && p.purchasable ? (
                    <button onClick={() => checkout(p.key)} disabled={busy === p.key} className="w-full py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center justify-center gap-1.5">
                      {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Choose {p.name}
                    </button>
                  ) : requested.has(p.key) ? (
                    <span className="block text-center text-xs font-bold text-emerald-600 py-2">✓ Requested</span>
                  ) : (
                    <button onClick={() => requestUpgrade(p.key, p.name)} disabled={busy === p.key} className="w-full py-2 rounded-control border border-brand-700 text-brand-700 hover:bg-brand-50 text-xs font-bold flex items-center justify-center gap-1.5">
                      {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Request {p.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-ink-400 text-center">Secure payments by Stripe. Cancel anytime from Manage billing.</p>
      </div>
    </div>
  );
}
