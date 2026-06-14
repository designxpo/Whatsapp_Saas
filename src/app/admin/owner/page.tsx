"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, CreditCard, ShieldCheck, Ban, Settings, LogOut, LogIn, Save } from "lucide-react";

const inp = "border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900";
type Features = { whatsapp: boolean; instagram: boolean; sequences: boolean; commerce: boolean; growth: boolean; ai_autoreply: boolean; ads: boolean };
type Tenant = {
  id: string; name: string; slug: string; status: string; plan: string; company: string | null;
  ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null; industry: string | null;
  teamSize: string | null; useCase: string | null; expectedVolume: string | null;
  paymentStatus: string; trialEndsAt: string | null; amountCents: number; currency: string; notes: string | null;
  features: Features; contacts: number; conversations: number; createdAt: string;
};
type Stats = { total: number; active: number; trialing: number; suspended: number; mrrCents: number };
const FEATURE_KEYS: (keyof Features)[] = ["whatsapp", "instagram", "sequences", "commerce", "growth", "ai_autoreply", "ads"];
const STATUSES = ["active", "trialing", "suspended", "cancelled"];
const PLANS = ["trial", "starter", "growth", "scale"];
const PAYMENTS = ["trialing", "active", "past_due", "cancelled", "none"];

export default function OwnerPortal() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<{ actorEmail: string; action: string; detail: string; at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/owner/tenants");
    if (res.status === 403) { setDenied(true); setLoading(false); return; }
    const d = await res.json().catch(() => ({}));
    setTenants(d.tenants ?? []); setStats(d.stats ?? null); setAudit(d.audit ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(t: Tenant) { setOpen(open === t.id ? null : t.id); setDraft({ ...t, features: { ...t.features } }); }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await fetch("/api/owner/tenants", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, status: draft.status, plan: draft.plan, paymentStatus: draft.paymentStatus, amountCents: draft.amountCents, trialEndsAt: draft.trialEndsAt, notes: draft.notes, features: draft.features }) });
      setOpen(null); load();
    } finally { setBusy(false); }
  }

  async function impersonate(id: string) {
    await fetch("/api/owner/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: id }) });
    router.push("/admin"); router.refresh();
  }

  const money = (c: number, cur: string) => `${cur} ${(c / 100).toLocaleString()}`;
  const badge = (s: string) => s === "active" ? "bg-emerald-50 text-emerald-700" : s === "suspended" || s === "cancelled" || s === "past_due" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700";

  if (loading) return <main className="min-h-screen flex items-center justify-center bg-canvas"><Loader2 className="w-6 h-6 animate-spin text-ink-400" /></main>;
  if (denied) return <main className="min-h-screen flex flex-col items-center justify-center gap-3 bg-canvas"><p className="text-sm text-ink-500">This area is for the product owner only.</p><a href="/admin" className="text-sm font-bold text-brand-700">← Back to app</a></main>;

  return (
    <main className="min-h-screen bg-canvas p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-brand-dark flex items-center gap-2"><ShieldCheck className="w-6 h-6" /> Owner Portal</h1>
            <p className="text-sm text-slate-500">Control every tenant — subscriptions, payments, features and access.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/admin/setup" className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> System setup</a>
            <button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }).catch(() => {}); router.push("/login"); }} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white flex items-center gap-1.5"><LogOut className="w-3.5 h-3.5" /> Log out</button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[["Tenants", stats.total, Users], ["Active", stats.active, ShieldCheck], ["Trialing", stats.trialing, CreditCard], ["Suspended", stats.suspended, Ban], ["MRR", money(stats.mrrCents, "INR"), CreditCard]].map(([label, val, Icon], i) => {
              const I = Icon as typeof Users;
              return <div key={i} className="bg-white rounded-card border border-line p-4"><div className="flex items-center gap-2 text-ink-400 text-[11px] font-bold uppercase"><I className="w-3.5 h-3.5" />{label as string}</div><p className="text-2xl font-extrabold text-ink-900 mt-1">{val as string}</p></div>;
            })}
          </div>
        )}

        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t.id} className="bg-white rounded-card border border-line">
              <div className="p-4 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-900 truncate">{t.company || t.name} <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge(t.status)}`}>{t.status}</span> <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ink-50 text-ink-500">{t.plan}</span></p>
                  <p className="text-[11px] text-ink-400 truncate">{t.ownerName} · {t.ownerEmail} · {t.ownerPhone || "no phone"} · {t.contacts} contacts · {t.conversations} chats</p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${badge(t.paymentStatus)}`}>{t.paymentStatus}</span>
                <button onClick={() => impersonate(t.id)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1"><LogIn className="w-3 h-3" /> View</button>
                <button onClick={() => edit(t)} className="px-2.5 py-1 rounded-control bg-ink-950 text-white text-xs font-bold">{open === t.id ? "Close" : "Manage"}</button>
              </div>

              {open === t.id && draft && draft.id === t.id && (
                <div className="border-t border-line p-4 space-y-3 bg-canvas/40">
                  {(t.industry || t.useCase) && <p className="text-[11px] text-ink-500">Signup: {t.industry} · goal: {t.useCase} · team {t.teamSize} · volume {t.expectedVolume}</p>}
                  <div className="flex flex-wrap gap-2">
                    <label className="text-[11px] text-ink-500">Status <select className={inp} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="text-[11px] text-ink-500">Plan <select className={inp} value={draft.plan} onChange={e => setDraft({ ...draft, plan: e.target.value })}>{PLANS.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="text-[11px] text-ink-500">Payment <select className={inp} value={draft.paymentStatus} onChange={e => setDraft({ ...draft, paymentStatus: e.target.value })}>{PAYMENTS.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="text-[11px] text-ink-500">Price/mo (₹) <input type="number" className={`${inp} w-24`} value={Math.round(draft.amountCents / 100)} onChange={e => setDraft({ ...draft, amountCents: Math.max(0, Number(e.target.value) || 0) * 100 })} /></label>
                    <label className="text-[11px] text-ink-500">Trial ends <input type="date" className={inp} value={draft.trialEndsAt ? draft.trialEndsAt.slice(0, 10) : ""} onChange={e => setDraft({ ...draft, trialEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-ink-400 uppercase mb-1">Features</p>
                    <div className="flex flex-wrap gap-3">
                      {FEATURE_KEYS.map(k => (
                        <label key={k} className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={draft.features[k]} onChange={e => setDraft({ ...draft, features: { ...draft.features, [k]: e.target.checked } })} /> {k}</label>
                      ))}
                    </div>
                  </div>
                  <textarea className={`${inp} w-full`} rows={2} placeholder="Owner notes (internal)" value={draft.notes ?? ""} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"><Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save changes"}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!tenants.length && <p className="text-xs text-ink-400">No tenants yet — they appear here when people sign up.</p>}
        </div>

        {audit.length > 0 && (
          <div className="bg-white rounded-card border border-line p-4">
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Recent owner actions</p>
            <div className="space-y-1">
              {audit.map((a, i) => <p key={i} className="text-[11px] text-ink-500"><span className="font-mono text-ink-400">{a.at.slice(0, 16).replace("T", " ")}</span> · {a.actorEmail} · <b>{a.action}</b> {a.detail}</p>)}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
