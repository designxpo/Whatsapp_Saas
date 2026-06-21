"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users, CreditCard, ShieldCheck, Ban, Settings, LogOut, LogIn, Save } from "lucide-react";
import { FEATURE_KEYS, FEATURE_META } from "@/lib/entitlement-registry";

const inp = "border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900";
type Features = Record<string, boolean>;
type Tenant = {
  id: string; name: string; slug: string; status: string; plan: string; company: string | null;
  ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null; industry: string | null;
  teamSize: string | null; useCase: string | null; expectedVolume: string | null;
  paymentStatus: string; trialEndsAt: string | null; amountCents: number; currency: string; notes: string | null;
  features: Features; grandfathered: boolean; contacts: number; conversations: number; createdAt: string;
};
type Stats = { total: number; active: number; trialing: number; suspended: number; mrrCents: number };
type PlanLimits = { contacts: number; conversations_per_month: number; messages_per_month: number; channels: number; team_seats: number };
type Plan = { id: string; key: string; name: string; priceCents: number; currency: string; interval: string; limits: PlanLimits; features: Features; sort: number; active: boolean; stripePriceId?: string | null };
type Ann = { id: string; title: string; body: string; level: "info" | "success" | "warning"; pinned: boolean; active: boolean; createdAt: string };
type TenantHealthRow = {
  id: string; name: string; status: string; plan: string; health: "ok" | "warn" | "todo" | "error";
  whatsapp: { configured: boolean; flag: string | null }; instagram: { configured: boolean };
  ai: { configured: boolean }; kb: { ready: number; total: number }; crm: { configured: boolean };
  integrations: { active: number; errored: number };
};
const STATUSES = ["active", "trialing", "suspended", "cancelled"];
const PLAN_FALLBACK = ["trial", "creator", "creator-pro", "starter", "growth", "scale"];
const PAYMENTS = ["trialing", "active", "past_due", "cancelled", "none"];

export default function OwnerPortal() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<{ actorEmail: string; action: string; detail: string; at: string; tenantId: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [flags, setFlags] = useState<{ key: string; enabled: boolean; description: string | null }[]>([]);
  const [analytics, setAnalytics] = useState<{ newThisMonth: number; trialsEndingSoon: number; signupsByDay: { date: string; count: number }[] } | null>(null);
  const [health, setHealth] = useState<TenantHealthRow[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/owner/tenants");
    if (res.status === 403) { setDenied(true); setLoading(false); return; }
    const d = await res.json().catch(() => ({}));
    setTenants(d.tenants ?? []); setStats(d.stats ?? null); setAudit(d.audit ?? []); setLoading(false);
    fetch("/api/owner/plans").then(r => r.json()).then(p => setPlans(p.plans ?? [])).catch(() => {});
    fetch("/api/owner/announcements").then(r => r.json()).then(a => setAnns(a.announcements ?? [])).catch(() => {});
    fetch("/api/owner/flags").then(r => r.json()).then(f => setFlags(f.flags ?? [])).catch(() => {});
    fetch("/api/owner/analytics").then(r => r.json()).then(a => setAnalytics(a.analytics ?? null)).catch(() => {});
    fetch("/api/owner/health").then(r => r.json()).then(h => setHealth(h.tenants ?? [])).catch(() => {});
  }, []);
  async function toggleFlag(key: string, enabled: boolean) {
    setFlags(fs => fs.map(f => f.key === key ? { ...f, enabled } : f));
    await fetch("/api/owner/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled }) }).catch(() => {});
  }
  useEffect(() => { load(); }, [load]);

  async function removeTenant(t: Tenant) {
    const name = t.company || t.name;
    const typed = window.prompt(`Permanently delete "${name}" and ALL its data? Type the name to confirm:`);
    if (typed === null) return;
    const res = await fetch("/api/owner/tenants", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, confirmName: typed }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Delete failed"); return; }
    setOpen(null); load();
  }

  const planMix = plans.length ? plans.map(p => ({ key: p.key, name: p.name, count: tenants.filter(t => t.plan === p.key).length })) : [];
  // Tenant-initiated plan-change requests (from the in-app billing page when
  // self-serve Stripe is off) — surfaced here so the owner can action them.
  const planRequests = audit.filter(a => a.action === "billing.request").slice(0, 8);

  // ── Plans ──
  const [planDraft, setPlanDraft] = useState<Plan | null>(null);
  const blankPlan: Plan = { id: "", key: "", name: "", priceCents: 0, currency: "INR", interval: "month", limits: { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 1, team_seats: 2 }, features: Object.fromEntries(FEATURE_KEYS.map(k => [k, true])), sort: plans.length, active: true, stripePriceId: "" };
  const planOptions = plans.length ? plans.map(p => p.key) : PLAN_FALLBACK;
  async function savePlan() {
    if (!planDraft || !planDraft.key.trim() || !planDraft.name.trim()) return;
    await fetch("/api/owner/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(planDraft) });
    setPlanDraft(null); load();
  }
  async function delPlan(id: string) { if (!confirm("Delete this plan?")) return; await fetch("/api/owner/plans", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); }

  // ── Announcements ──
  const [annForm, setAnnForm] = useState<{ title: string; body: string; level: Ann["level"]; pinned: boolean }>({ title: "", body: "", level: "info", pinned: false });
  async function saveAnn() {
    if (!annForm.title.trim()) return;
    await fetch("/api/owner/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(annForm) });
    setAnnForm({ title: "", body: "", level: "info", pinned: false }); load();
  }
  async function setAnn(id: string, patch: Partial<Ann>) {
    const a = anns.find(x => x.id === id); if (!a) return;
    await fetch("/api/owner/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title: a.title, body: a.body, level: a.level, pinned: a.pinned, active: a.active, ...patch }) });
    load();
  }
  async function delAnn(id: string) { await fetch("/api/owner/announcements", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); }

  function edit(t: Tenant) { setOpen(open === t.id ? null : t.id); setDraft({ ...t, features: { ...t.features } }); }
  // Open a tenant's editor AND scroll it into view (used from the requests card,
  // whose Manage button otherwise expands an editor far down the page).
  function manage(t: Tenant) {
    setOpen(t.id); setDraft({ ...t, features: { ...t.features } });
    setTimeout(() => document.getElementById(`tenant-${t.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await fetch("/api/owner/tenants", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, status: draft.status, plan: draft.plan, paymentStatus: draft.paymentStatus, amountCents: draft.amountCents, trialEndsAt: draft.trialEndsAt, notes: draft.notes, features: draft.features, grandfathered: draft.grandfathered }) });
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
            <a href="/admin" className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white flex items-center gap-1.5"><LogIn className="w-3.5 h-3.5" /> App dashboard</a>
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

        {planMix.length > 0 && (
          <div className="bg-white rounded-card border border-line p-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500">
            <span className="font-bold uppercase text-ink-400">Plan mix</span>
            {planMix.map(p => <span key={p.key}>{p.name}: <b className="text-ink-800">{p.count}</b></span>)}
          </div>
        )}

        {planRequests.length > 0 && (
          <div className="bg-white rounded-card border border-amber-200 p-4 space-y-2">
            <p className="text-xs font-bold text-amber-600 uppercase">Plan upgrade requests</p>
            {planRequests.map((r, i) => {
              const t = tenants.find(x => x.id === r.tenantId);
              return (
                <div key={i} className="flex items-center gap-3 text-xs border border-line rounded-control px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink-900 truncate">{t?.company || t?.name || r.actorEmail}</p>
                    <p className="text-ink-400 truncate">{r.detail} · {r.actorEmail} · {r.at.slice(0, 16).replace("T", " ")}</p>
                  </div>
                  {t && <button onClick={() => manage(t)} className="px-2.5 py-1 rounded-control bg-ink-950 text-white font-bold shrink-0">Manage</button>}
                </div>
              );
            })}
          </div>
        )}

        {analytics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-card border border-line p-4"><p className="text-[11px] font-bold uppercase text-ink-400">New this month</p><p className="text-2xl font-extrabold text-ink-900 mt-1">{analytics.newThisMonth}</p></div>
            <div className="bg-white rounded-card border border-line p-4"><p className="text-[11px] font-bold uppercase text-ink-400">Trials ending ≤7d</p><p className="text-2xl font-extrabold text-ink-900 mt-1">{analytics.trialsEndingSoon}</p></div>
            <div className="bg-white rounded-card border border-line p-4 col-span-2">
              <p className="text-[11px] font-bold uppercase text-ink-400 mb-1">Signups · last 30 days</p>
              <div className="flex items-end gap-0.5 h-10">
                {analytics.signupsByDay.map((d, i) => {
                  const max = Math.max(1, ...analytics.signupsByDay.map(x => x.count));
                  return <div key={i} title={`${d.date}: ${d.count}`} className="flex-1 bg-brand-500/70 rounded-sm" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />;
                })}
              </div>
            </div>
          </div>
        )}

        {/* Feature flags */}
        {flags.length > 0 && (
          <div className="bg-white rounded-card border border-line p-4 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase">Platform feature flags</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {flags.map(f => (
                <label key={f.key} className="flex items-center justify-between gap-3 border border-line rounded-control px-3 py-2">
                  <span><span className="text-xs font-bold text-ink-800">{f.key}</span>{f.description && <span className="block text-[11px] text-ink-400">{f.description}</span>}</span>
                  <input type="checkbox" className="accent-brand-700 w-4 h-4 shrink-0" checked={f.enabled} onChange={e => toggleFlag(f.key, e.target.checked)} />
                </label>
              ))}
            </div>
          </div>
        )}

        {health.length > 0 && (() => {
          const broken = health.filter(h => h.health === "error");
          const warn = health.filter(h => h.health === "warn");
          const dot = (s: string) => s === "error" ? "bg-red-500" : s === "warn" ? "bg-amber-500" : s === "ok" ? "bg-emerald-500" : "bg-slate-300";
          const chip = (label: string, ok: boolean, extra?: string) => (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{label}{extra ? ` ${extra}` : ""}</span>
          );
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-slate-400 uppercase">Setup health</p>
                <p className="text-[11px] font-bold">{broken.length ? <span className="text-red-600">{broken.length} need attention</span> : <span className="text-emerald-600">All {health.length} healthy</span>}{warn.length ? <span className="text-amber-600"> · {warn.length} warning{warn.length === 1 ? "" : "s"}</span> : null}</p>
              </div>
              {health.map(h => (
                <div key={h.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot(h.health)}`} title={h.health} />
                  <p className="text-sm font-semibold text-ink-900 truncate flex-1 min-w-0">{h.name} <span className="text-[10px] text-ink-400">· {h.status}</span></p>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {chip("WhatsApp", h.whatsapp.configured)}
                    {h.whatsapp.flag && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">{h.whatsapp.flag}</span>}
                    {chip("AI", h.ai.configured)}
                    {chip("KB", h.kb.ready > 0, `${h.kb.ready}/${h.kb.total}`)}
                    {chip("CRM", h.crm.configured)}
                    {chip("IG", h.instagram.configured)}
                    {h.integrations?.active > 0 && (h.integrations.errored > 0
                      ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Integrations {h.integrations.errored}✕</span>
                      : chip("Integrations", true, String(h.integrations.active)))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-slate-400 uppercase">Tenants</p>
            <input className={`${inp} w-56`} placeholder="Search name / email / slug…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {tenants.filter(t => { const s = q.trim().toLowerCase(); return !s || [t.name, t.company, t.ownerEmail, t.slug].some(v => (v ?? "").toLowerCase().includes(s)); }).map(t => (
            <div key={t.id} id={`tenant-${t.id}`} className="bg-white rounded-card border border-line scroll-mt-4">
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
                    <label className="text-[11px] text-ink-500">Plan <select className={inp} value={draft.plan} onChange={e => setDraft({ ...draft, plan: e.target.value })}>{planOptions.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="text-[11px] text-ink-500">Payment <select className={inp} value={draft.paymentStatus} onChange={e => setDraft({ ...draft, paymentStatus: e.target.value })}>{PAYMENTS.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="text-[11px] text-ink-500">Price/mo (₹) <input type="number" className={`${inp} w-24`} value={Math.round(draft.amountCents / 100)} onChange={e => setDraft({ ...draft, amountCents: Math.max(0, Number(e.target.value) || 0) * 100 })} /></label>
                    <label className="text-[11px] text-ink-500">Trial ends <input type="date" className={inp} value={draft.trialEndsAt ? draft.trialEndsAt.slice(0, 10) : ""} onChange={e => setDraft({ ...draft, trialEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] font-semibold text-ink-600 bg-white border border-line rounded-control px-3 py-2 w-fit cursor-pointer">
                    <input type="checkbox" className="accent-brand-700 w-4 h-4" checked={draft.grandfathered} onChange={e => setDraft({ ...draft, grandfathered: e.target.checked })} />
                    Grandfathered — full access regardless of plan (turn off to enforce the plan + overrides below)
                  </label>
                  <div className={draft.grandfathered ? "opacity-40 pointer-events-none" : ""}>
                    <p className="text-[11px] font-bold text-ink-400 uppercase mb-1">Feature overrides <span className="font-normal normal-case">— grant or revoke per tenant (overrides the plan)</span></p>
                    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                      {FEATURE_KEYS.map(k => (
                        <label key={k} className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={!!draft.features[k]} onChange={e => setDraft({ ...draft, features: { ...draft.features, [k]: e.target.checked } })} /> {FEATURE_META[k].label} <span className="text-ink-300">· {k}</span></label>
                      ))}
                    </div>
                  </div>
                  <textarea className={`${inp} w-full`} rows={2} placeholder="Owner notes (internal)" value={draft.notes ?? ""} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"><Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save changes"}</button>
                    <div className="flex-1" />
                    <button onClick={() => removeTenant(t)} className="px-3 py-1.5 rounded-control border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold">Delete tenant</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!tenants.length && <p className="text-xs text-ink-400">No tenants yet — they appear here when people sign up.</p>}
        </div>

        {/* Plans */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase">Plans & pricing</p>
            <button onClick={() => setPlanDraft({ ...blankPlan })} className="px-2.5 py-1 rounded-control bg-ink-950 text-white text-xs font-bold">+ New plan</button>
          </div>
          {plans.map(p => (
            <div key={p.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink-900">{p.name} <span className="text-ink-400 font-mono">{p.key}</span> {!p.active && <span className="text-red-500">· off</span>}</p>
                <p className="text-ink-400">{money(p.priceCents, p.currency)}/{p.interval} · {p.limits.contacts || "∞"} contacts · {p.limits.conversations_per_month || "∞"} convos/mo · {p.limits.messages_per_month || "∞"} msgs/mo · {p.limits.channels || "∞"} channels · {p.limits.team_seats || "∞"} seats</p>
              </div>
              <button onClick={() => setPlanDraft({ ...p })} className="px-2 py-1 rounded-control border border-line font-bold text-ink-600 hover:bg-canvas">Edit</button>
              <button onClick={() => delPlan(p.id)} className="px-2 py-1 rounded-control border border-red-200 text-red-600 hover:bg-red-50 font-bold">Del</button>
            </div>
          ))}
          {planDraft && (
            <div className="border-2 border-brand-700/30 rounded-control p-3 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Plan name" value={planDraft.name} onChange={e => setPlanDraft({ ...planDraft, name: e.target.value })} />
              <input className={inp} placeholder="key (e.g. growth)" value={planDraft.key} onChange={e => setPlanDraft({ ...planDraft, key: e.target.value })} />
              <label className="text-[11px] text-ink-500">Price/mo (₹) <input type="number" className={`${inp} w-full`} value={Math.round(planDraft.priceCents / 100)} onChange={e => setPlanDraft({ ...planDraft, priceCents: Math.max(0, Number(e.target.value) || 0) * 100 })} /></label>
              <label className="text-[11px] text-ink-500 flex items-center gap-1.5 pt-4"><input type="checkbox" className="accent-brand-700" checked={planDraft.active} onChange={e => setPlanDraft({ ...planDraft, active: e.target.checked })} /> active</label>
              <label className="text-[11px] text-ink-500">Contacts (0=∞) <input type="number" className={`${inp} w-full`} value={planDraft.limits.contacts} onChange={e => setPlanDraft({ ...planDraft, limits: { ...planDraft.limits, contacts: Number(e.target.value) || 0 } })} /></label>
              <label className="text-[11px] text-ink-500">Conversations/mo (0=∞) <input type="number" className={`${inp} w-full`} value={planDraft.limits.conversations_per_month} onChange={e => setPlanDraft({ ...planDraft, limits: { ...planDraft.limits, conversations_per_month: Number(e.target.value) || 0 } })} /></label>
              <label className="text-[11px] text-ink-500">Messages/mo (0=∞) <input type="number" className={`${inp} w-full`} value={planDraft.limits.messages_per_month} onChange={e => setPlanDraft({ ...planDraft, limits: { ...planDraft.limits, messages_per_month: Number(e.target.value) || 0 } })} /></label>
              <label className="text-[11px] text-ink-500">Channels (0=∞) <input type="number" className={`${inp} w-full`} value={planDraft.limits.channels} onChange={e => setPlanDraft({ ...planDraft, limits: { ...planDraft.limits, channels: Number(e.target.value) || 0 } })} /></label>
              <label className="text-[11px] text-ink-500">Team seats (0=∞) <input type="number" className={`${inp} w-full`} value={planDraft.limits.team_seats} onChange={e => setPlanDraft({ ...planDraft, limits: { ...planDraft.limits, team_seats: Number(e.target.value) || 0 } })} /></label>
              <label className="col-span-2 text-[11px] text-ink-500">Stripe Price ID (price_… — required to sell this plan via Stripe) <input className={`${inp} w-full font-mono`} placeholder="price_1AbcD… (leave blank if not on Stripe)" value={planDraft.stripePriceId ?? ""} onChange={e => setPlanDraft({ ...planDraft, stripePriceId: e.target.value.trim() })} /></label>
              <div className="col-span-2 flex gap-2"><button onClick={savePlan} className="px-4 py-1.5 rounded-control bg-brand-700 text-white text-xs font-bold">Save plan</button><button onClick={() => setPlanDraft(null)} className="px-2 text-xs text-ink-400">Cancel</button></div>
            </div>
          )}
        </div>

        {/* Announcements */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Announcements (pinned = banner for all tenants)</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Title" value={annForm.title} onChange={e => setAnnForm({ ...annForm, title: e.target.value })} />
            <select className={inp} value={annForm.level} onChange={e => setAnnForm({ ...annForm, level: e.target.value as Ann["level"] })}><option value="info">info</option><option value="success">success</option><option value="warning">warning</option></select>
            <input className={`${inp} col-span-2`} placeholder="Message (optional)" value={annForm.body} onChange={e => setAnnForm({ ...annForm, body: e.target.value })} />
            <label className="text-[11px] text-ink-500 flex items-center gap-1.5"><input type="checkbox" className="accent-brand-700" checked={annForm.pinned} onChange={e => setAnnForm({ ...annForm, pinned: e.target.checked })} /> pin as global banner</label>
            <div><button onClick={saveAnn} className="px-4 py-1.5 rounded-control bg-brand-700 text-white text-xs font-bold">Post</button></div>
          </div>
          {anns.map(a => (
            <div key={a.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2 text-xs">
              <div className="min-w-0 flex-1"><p className="font-bold text-ink-900 truncate">{a.title} {a.pinned && <span className="text-brand-700">· pinned</span>}{!a.active && <span className="text-red-500"> · off</span>}</p>{a.body && <p className="text-ink-400 truncate">{a.body}</p>}</div>
              <button onClick={() => setAnn(a.id, { pinned: !a.pinned })} className="px-2 py-1 rounded-control border border-line font-bold text-ink-600 hover:bg-canvas">{a.pinned ? "Unpin" : "Pin"}</button>
              <button onClick={() => setAnn(a.id, { active: !a.active })} className="px-2 py-1 rounded-control border border-line font-bold text-ink-600 hover:bg-canvas">{a.active ? "Hide" : "Show"}</button>
              <button onClick={() => delAnn(a.id)} className="px-2 py-1 rounded-control border border-red-200 text-red-600 hover:bg-red-50 font-bold">Del</button>
            </div>
          ))}
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
