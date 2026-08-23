"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Loader2, CreditCard, Check, X, ArrowLeft, ExternalLink, AlertTriangle, Pencil } from "lucide-react";
import { FEATURE_KEYS, FEATURE_META } from "@/lib/entitlement-registry";

declare global {
  interface Window { Razorpay: new (options: Record<string, unknown>) => { open: () => void }; }
}

type Limits = { contacts: number; conversations_per_month?: number; messages_per_month: number; channels: number; team_seats: number };
type PlanRow = { key: string; name: string; priceCents: number; currency: string; interval: string; limits: Limits; features?: Record<string, boolean>; purchasable: boolean; purchasableViaRazorpay: boolean; baseAmountCents: number; taxCents: number; gatewayFeeEstimateCents: number; totalChargedCents: number };
type Current = { plan: string; paymentStatus: string; amountCents: number; currency: string; trialEndsAt: string | null; currentPeriodEnd: string | null; hasSubscription: boolean; hasCustomer: boolean };
type BillingDetails = { gstin: string | null; billingLegalName: string | null; billingAddress: string | null; billingState: string | null; billingStateCode: string | null; billingCountry: string | null };
type DetailsResponse = { details?: BillingDetails; company?: string | null; complete?: boolean; taxInvoiceReady?: boolean };

const money = (c: number, cur: string) => `${cur === "INR" ? "₹" : cur + " "}${(c / 100).toLocaleString()}`;
const lim = (n: number) => (n === 0 ? "Unlimited" : n.toLocaleString());
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700", trialing: "bg-amber-50 text-amber-700",
  past_due: "bg-red-50 text-red-700", cancelled: "bg-slate-100 text-slate-600", none: "bg-slate-100 text-slate-600",
};

// The official GST state codes — the first two digits of every GSTIN, and the
// value that decides CGST+SGST (same state as us) vs IGST. Nobody knows that
// Delhi is 07, so this is a picker rather than a text box the customer has to
// get right on a form that gates their payment.
//
// 25 (Daman & Diu) and 28 (undivided Andhra Pradesh) are deliberately absent:
// both were retired into 26 and 37, and offering a dead code here would put it
// on a live invoice.
const GST_STATES: [string, string][] = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"],
  ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"],
  ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"],
  ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"],
  ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"],
  ["35", "Andaman & Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
  ["97", "Other Territory"], ["99", "Centre Jurisdiction"],
];
const stateName = (code: string) => GST_STATES.find(([c]) => c === code)?.[1] ?? "";

export default function BillingPage() {
  const router = useRouter();
  const [stripeOn, setStripeOn] = useState(true);
  const [razorpayOn, setRazorpayOn] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // GST billing identity — who we invoice. `detailsComplete` mirrors the
  // server's hasBillingIdentity(), and gates checkout below.
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [detailsComplete, setDetailsComplete] = useState(false);   // fail closed: no checkout until the server says we can invoice
  const [taxInvoiceReady, setTaxInvoiceReady] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({ legalName: "", address: "", stateCode: "", gstin: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const detailsPanel = useRef<HTMLDivElement | null>(null);
  const legalNameInput = useRef<HTMLInputElement | null>(null);

  const applyDetails = useCallback((d: DetailsResponse) => {
    const dt = d.details ?? null;
    setDetails(dt);
    setDetailsComplete(d.complete === true);
    setTaxInvoiceReady(d.taxInvoiceReady === true);
    setDetailsForm({
      // `||` not `??`: hasBillingIdentity() accepts the company name in place of
      // a legal name, so prefill from it rather than showing an empty box.
      legalName: dt?.billingLegalName || d.company || "",
      address: dt?.billingAddress || "",
      stateCode: dt?.billingStateCode || "",
      gstin: dt?.gstin || "",
    });
    // Nothing recorded yet → open the form straight away. A panel that needs a
    // click before it becomes a form is one more step in front of a payment.
    if (d.complete !== true) setEditingDetails(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, bd] = await Promise.all([
        fetch("/api/admin/billing").then(r => r.json()),
        fetch("/api/admin/billing/details").then(r => r.json()),
      ]);
      setStripeOn(d.stripeConfigured !== false);
      setRazorpayOn(d.razorpayConfigured === true);
      setCurrent(d.current ?? null);
      setPlans(d.plans ?? []);
      applyDetails(bd);
    } catch { setMsg("Could not load billing."); }
    finally { setLoading(false); }
  }, [applyDetails]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s === "success") setBanner("Subscription active — thanks! It may take a few seconds to reflect.");
    if (s === "cancelled") setBanner("Checkout cancelled — no charge was made.");
  }, []);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSavingDetails(true); setDetailsError(null);
    try {
      const res = await fetch("/api/admin/billing/details", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingLegalName: detailsForm.legalName, billingAddress: detailsForm.address,
          billingStateCode: detailsForm.stateCode,
          // The picker is the only place the code→name pairing is known, so the
          // name travels WITH the code instead of being re-derived server-side.
          billingState: stateName(detailsForm.stateCode), gstin: detailsForm.gstin,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setDetailsError(d.error || "Could not save billing details"); return; }
      applyDetails(d);
      setEditingDetails(false); setMsg(null);
      // `detailsComplete` is still the PRE-save value in this closure, which is
      // exactly the distinction worth making: a first fill unblocks checkout, a
      // later edit only changes what the next invoice says.
      setBanner(detailsComplete ? "Billing details saved — your next invoice will use them." : "Billing details saved — you can complete checkout now.");
    } catch { setDetailsError("Could not save billing details"); }
    finally { setSavingDetails(false); }
  }

  // CHECKOUT GATE. An invoice is issued the moment a payment lands and keeps
  // whatever recipient details were recorded then, so the details have to exist
  // BEFORE the payment, not after. Rather than disabling the plan buttons (a
  // dead button with no reason is the worst version of this), the click surfaces
  // the form, focuses it, and says why.
  function billingDetailsReady(): boolean {
    if (detailsComplete) return true;
    setEditingDetails(true);
    setMsg("Add your billing details first — Indian GST rules need the name, address and state we invoice before we can take a payment.");
    // Wait a frame so the form is mounted before we scroll to and focus it.
    requestAnimationFrame(() => {
      detailsPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      legalNameInput.current?.focus();
    });
    return false;
  }

  async function checkout(planKey: string) {
    if (!billingDetailsReady()) return;
    setBusy(planKey); setMsg(null);
    try {
      const res = await fetch("/api/admin/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not start checkout"); return; }
      window.location.href = d.url;
    } finally { setBusy(null); }
  }

  // Razorpay Subscriptions checkout — opens checkout.js's in-page MODAL
  // (unlike Stripe's hosted-page redirect above), so this stays on /admin/billing
  // throughout: create the subscription, open the modal, verify the payment
  // in its `handler`, then reload this page's own data instead of navigating.
  async function checkoutRazorpay(planKey: string, planName: string) {
    if (!billingDetailsReady()) return;
    setBusy(planKey); setMsg(null);
    try {
      const res = await fetch("/api/admin/billing/razorpay/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not start checkout"); setBusy(null); return; }
      if (typeof window.Razorpay !== "function") { setMsg("Payment could not load — please refresh and try again."); setBusy(null); return; }

      const rzp = new window.Razorpay({
        key: d.razorpayKeyId,
        subscription_id: d.subscriptionId,
        name: "Talko AI",
        description: `${planName} subscription — all-inclusive`,
        handler: async (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
          try {
            const v = await fetch("/api/admin/billing/razorpay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(resp) });
            const vd = await v.json();
            if (!v.ok) { setMsg(vd.error || "Payment could not be verified"); return; }
            setBanner("Subscription active — thanks!");
            await load();
          } finally { setBusy(null); }
        },
        modal: { ondismiss: () => setBusy(null) },   // user closed the modal without paying
        theme: { color: "#0783fd" },
      });
      rzp.open();
    } catch {
      setMsg("Could not start checkout"); setBusy(null);
    }
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
      setBanner(`Request sent — our team will move you to ${planName} shortly.`);
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
        {!stripeOn && !razorpayOn && <div className="bg-amber-50 text-amber-800 text-sm rounded-card px-4 py-3">Online payments aren&apos;t enabled yet — billing is managed by our team. Pick a plan below and tap <b>Request</b>; we&apos;ll switch you over and confirm.</div>}

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

        {/* Billing details — the recipient block of a GST invoice. Asked for
            here rather than at signup because it's the first paid checkout that
            needs it, which is also why checkout below is gated on it. */}
        <div ref={detailsPanel} className="bg-white rounded-card border border-line p-5">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase">Billing details</p>
              <p className="text-xs text-ink-500 mt-1">Who we invoice, and the state that decides your GST split.</p>
            </div>
            {detailsComplete && !editingDetails && (
              <button onClick={() => setEditingDetails(true)} className="px-4 py-2 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas flex items-center gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {!detailsComplete && (
            <div className="mt-3 bg-amber-50 text-amber-800 text-xs rounded-control px-3 py-2.5 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>We need these before your first payment. An invoice is issued the moment a charge lands and keeps whatever details were recorded then, so they can&apos;t be filled in afterwards.</span>
            </div>
          )}

          {!editingDetails ? (
            <dl className="mt-4 grid sm:grid-cols-2 gap-y-3 gap-x-4 text-xs">
              <div>
                <dt className="text-ink-400">Registered name</dt>
                {/* detailsForm.legalName is the RESOLVED name (saved legal name,
                    else the company name) — the same value the invoice prints. */}
                <dd className="text-ink-900 font-semibold mt-0.5">{detailsForm.legalName || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">GSTIN</dt>
                <dd className="text-ink-900 font-semibold font-mono mt-0.5">{details?.gstin || "Not GST-registered"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Billing address</dt>
                <dd className="text-ink-900 font-semibold mt-0.5 whitespace-pre-line">{details?.billingAddress || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">State</dt>
                <dd className="text-ink-900 font-semibold mt-0.5">{details?.billingStateCode ? `${details.billingState || stateName(details.billingStateCode)} (${details.billingStateCode})` : "—"}</dd>
              </div>
            </dl>
          ) : (
            <form onSubmit={saveDetails} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold text-ink-600">Registered name</span>
                <input ref={legalNameInput} className={`${inp} mt-1`} value={detailsForm.legalName} onChange={e => setDetailsForm(f => ({ ...f, legalName: e.target.value }))}
                  placeholder="Legal name of the business or person we invoice" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-ink-600">Billing address</span>
                <textarea className={`${inp} mt-1 min-h-[70px]`} value={detailsForm.address} onChange={e => setDetailsForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Street, city, PIN code" />
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-bold text-ink-600">State</span>
                  <select className={`${inp} mt-1`} value={detailsForm.stateCode} onChange={e => setDetailsForm(f => ({ ...f, stateCode: e.target.value }))}>
                    <option value="">Select your state…</option>
                    {GST_STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
                  </select>
                  <span className="block text-[10px] text-ink-400 mt-1">The 2-digit GST state code decides CGST+SGST vs IGST on your invoice.</span>
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-ink-600">GSTIN <span className="font-medium text-ink-400">(optional)</span></span>
                  <input className={`${inp} mt-1 font-mono uppercase`} value={detailsForm.gstin} maxLength={15} onChange={e => setDetailsForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                    placeholder="27AAAAA0000A1Z5" />
                  {/* Only a tax invoice from a GST-registered supplier can carry
                      input tax credit, so don't promise ITC we can't issue. */}
                  <span className="block text-[10px] text-ink-400 mt-1">
                    {taxInvoiceReady
                      ? "Needed to claim input tax credit on the GST we charge you — leave blank if you aren't registered."
                      : "We'll record it on your billing documents; input tax credit applies once we issue tax invoices."}
                  </span>
                </label>
              </div>
              {detailsError && <p className="text-xs text-red-700 bg-red-50 rounded-control px-3 py-2">{detailsError}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={savingDetails} className="px-4 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5">
                  {savingDetails ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save billing details
                </button>
                {detailsComplete && (
                  <button type="button" onClick={() => { setEditingDetails(false); setDetailsError(null); }} className="px-4 py-2 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">Cancel</button>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Plan grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => {
            const isCurrent = current?.plan === p.key;
            return (
              <div key={p.key} className={`bg-white rounded-card border p-5 flex flex-col ${isCurrent ? "border-brand-700 ring-1 ring-brand-700/20" : "border-line"}`}>
                <p className="text-sm font-extrabold text-ink-900">{p.name}</p>
                {/* The all-inclusive amount IS the price — there is no tax line
                    and no separate fee line to disclose, so showing one number
                    is both simpler and the only honest presentation. */}
                <p className="text-2xl font-extrabold text-ink-900 mt-1">{p.totalChargedCents === 0 ? "Free" : money(p.totalChargedCents, p.currency)}<span className="text-xs font-medium text-ink-400">{p.totalChargedCents ? `/${p.interval}` : ""}</span></p>
                {p.totalChargedCents > 0 && (
                  <p className="text-[11px] text-ink-400 mt-0.5">All-inclusive — no tax or processing charges added at checkout.</p>
                )}
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
                  ) : razorpayOn && p.purchasableViaRazorpay ? (
                    <button onClick={() => checkoutRazorpay(p.key, p.name)} disabled={busy === p.key} className="w-full py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center justify-center gap-1.5">
                      {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Choose {p.name}
                    </button>
                  ) : requested.has(p.key) ? (
                    <span className="flex items-center justify-center gap-1 text-center text-xs font-bold text-emerald-600 py-2"><Check className="w-3.5 h-3.5" /> Requested</span>
                  ) : (
                    <button onClick={() => requestUpgrade(p.key, p.name)} disabled={busy === p.key} className="w-full py-2 rounded-control border border-brand-700 text-brand-700 hover:bg-brand-50 text-xs font-bold flex items-center justify-center gap-1.5">
                      {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Request {p.name}
                    </button>
                  )}
                  {/* The button stays live and explains itself on click (see
                      billingDetailsReady) — this is the heads-up before it. */}
                  {!isCurrent && !detailsComplete && ((stripeOn && p.purchasable) || (razorpayOn && p.purchasableViaRazorpay)) && (
                    <p className="mt-1.5 text-[10px] text-amber-700 text-center">Billing details needed first</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-ink-400 text-center">
          {stripeOn && razorpayOn ? "Secure payments by Stripe and Razorpay."
            : razorpayOn ? "Secure payments by Razorpay."
            : "Secure payments by Stripe."} Cancel anytime from Manage billing.
        </p>
      </div>
      {razorpayOn && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />}
    </div>
  );
}
