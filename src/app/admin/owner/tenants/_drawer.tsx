"use client";

// Tenant drawer — everything about one account, loaded only when opened.
//
// This is where the expensive per-tenant work now lives. The list route resolves
// nothing per row; entitlements, usage, channels and audit history are fetched
// here, once, for the single account an operator actually clicked.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2, Save, Trash2, Mail, Phone } from "lucide-react";
import { FEATURE_KEYS, FEATURE_META } from "@/lib/entitlement-registry";
import {
  Drawer, Badge, Panel, Spinner, money, compact, ago, until,
  STATUS_TONE, PAYMENT_TONE, type ConfirmCfg,
} from "../_ui";

type Detail = {
  tenant: Record<string, unknown> & {
    id: string; name: string; slug: string; status: string; plan: string; company: string | null;
    ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
    paymentStatus: string; trialEndsAt: string | null; amountCents: number; currency: string;
    notes: string | null; grandfathered: boolean; createdAt: string; features: Record<string, boolean>;
  };
  usage: { contacts: number; conversations: number; messages: number; channels: number; seats: number } | null;
  limits: Record<string, number> | null;
  channels: { id: string; kind: string; name: string; active: boolean; qualityRating: string | null; messagingHealth: string | null; marketingPaused: boolean }[];
  metrics: { health: string; usagePctMax: number; lastInboundAt: string | null; integrationsErrored: number; refreshedAt: string } | null;
  audit: { actorEmail: string; action: string; detail: string; at: string }[];
  error?: string;
};

const TABS = ["overview", "billing", "features", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", billing: "Billing", features: "Features", activity: "Activity" };

const STATUSES = ["active", "trialing", "suspended", "cancelled"];
const PAYMENTS = ["trialing", "active", "past_due", "cancelled", "none"];
const inp = "border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900 w-full";

export function TenantDrawer({ id, onClose, onChanged, setConfirm }: {
  id: string; onClose: () => void; onChanged: () => void; setConfirm: (c: ConfirmCfg) => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<string[]>([]);

  const load = useCallback(async () => {
    setD(null); setErr(null);
    try {
      const r = await fetch(`/api/owner/tenants/${id}`);
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); return; }
      setD(j); setDraft({ ...j.tenant });
    } catch { setErr("Couldn't reach the server."); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/owner/plans").then(r => r.json()).then(p => setPlans((p.plans ?? []).map((x: { key: string }) => x.key))).catch(() => {}); }, []);

  const t = d?.tenant;
  const label = t ? (t.company || t.name) : "Loading…";

  async function save() {
    if (!draft || !t) return;
    setBusy(true);
    try {
      const r = await fetch("/api/owner/tenants", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: t.id, status: draft.status, plan: draft.plan, paymentStatus: draft.paymentStatus,
          trialEndsAt: draft.trialEndsAt || null, amountCents: Number(draft.amountCents) || 0,
          currency: draft.currency, notes: draft.notes, grandfathered: draft.grandfathered,
          features: draft.features,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Save failed");
      await load(); onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function impersonate() {
    if (!t) return;
    await fetch("/api/owner/impersonate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: t.id }),
    });
    router.push("/admin"); router.refresh();
  }

  return (
    <Drawer open onClose={onClose} title={label}
      subtitle={t ? <span className="font-mono">{t.slug} · joined {ago(t.createdAt)}</span> : undefined}
      actions={t && (
        <button onClick={impersonate} title="Open their workspace as support (session expires in 1 hour)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">
          <LogIn className="w-3.5 h-3.5" /> Open workspace
        </button>
      )}>

      {err && <div className="bg-red-50 border border-red-200 rounded-control px-3 py-2.5 text-[13px] text-red-700">{err}</div>}
      {!d && !err && <div className="flex justify-center py-16"><Spinner /></div>}

      {d && t && draft && (
        <>
          <div className="flex items-center gap-1 bg-white border border-line rounded-control p-1">
            {TABS.map(x => (
              <button key={x} onClick={() => setTab(x)}
                className={`flex-1 px-2 py-1.5 rounded text-[12px] font-bold transition ${tab === x ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
                {TAB_LABEL[x]}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              <Panel title="Contact">
                <div className="space-y-1.5 text-[13px]">
                  <Field label="Owner" value={t.ownerName ?? "—"} />
                  <Field label="Email" value={t.ownerEmail
                    ? <a href={`mailto:${t.ownerEmail}`} className="font-mono text-brand-700 hover:underline inline-flex items-center gap-1"><Mail className="w-3 h-3" />{t.ownerEmail}</a>
                    : "—"} />
                  <Field label="Phone" value={t.ownerPhone
                    ? <span className="font-mono inline-flex items-center gap-1"><Phone className="w-3 h-3" />{t.ownerPhone}</span>
                    : "—"} />
                </div>
              </Panel>

              <Panel title="Health" action={d.metrics && <span className="text-[10px] text-ink-400">as of {ago(d.metrics.refreshedAt)}</span>}>
                {!d.channels.length && <p className="text-[13px] text-ink-600">No channel connected yet.</p>}
                <div className="space-y-2">
                  {d.channels.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-ink-900 truncate"><b className="capitalize">{c.kind}</b> · {c.name}</span>
                      <div className="flex gap-1 shrink-0">
                        {!c.active && <Badge tone="muted">off</Badge>}
                        {c.qualityRating && <Badge tone={c.qualityRating === "RED" ? "bad" : c.qualityRating === "YELLOW" ? "warn" : "ok"}>{c.qualityRating}</Badge>}
                        {c.messagingHealth && c.messagingHealth !== "AVAILABLE" && <Badge tone="bad">{c.messagingHealth}</Badge>}
                        {c.marketingPaused && <Badge tone="bad">paused</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
                {d.metrics && (
                  <div className="mt-3 pt-3 border-t border-line space-y-1.5 text-[13px]">
                    <Field label="Last inbound" value={ago(d.metrics.lastInboundAt)} />
                    {d.metrics.integrationsErrored > 0 && <Field label="Integrations" value={<span className="text-red-600">{d.metrics.integrationsErrored} erroring</span>} />}
                  </div>
                )}
              </Panel>

              {d.usage && d.limits && (
                <Panel title="Usage">
                  <div className="space-y-2">
                    {([["Contacts", d.usage.contacts, d.limits.contacts],
                       ["Conversations", d.usage.conversations, d.limits.conversations_per_month],
                       ["Messages", d.usage.messages, d.limits.messages_per_month],
                       ["Channels", d.usage.channels, d.limits.channels],
                       ["Seats", d.usage.seats, d.limits.team_seats]] as [string, number, number][])
                      .map(([lab, used, lim]) => {
                        const pct = lim > 0 ? Math.min(100, Math.round((used / lim) * 100)) : 0;
                        const near = lim > 0 && pct >= 80;
                        return (
                          <div key={lab}>
                            <div className="flex justify-between text-[11px] mb-0.5">
                              <span className="text-ink-600">{lab}</span>
                              <span className={`tabular-nums ${near ? "text-amber-600 font-bold" : "text-ink-400"}`}>{compact(used)} / {lim > 0 ? compact(lim) : "∞"}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                              <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : near ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${lim > 0 ? pct : 4}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </Panel>
              )}
            </>
          )}

          {tab === "billing" && (
            <Panel title="Subscription" action={
              <button onClick={save} disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            }>
              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Plan">
                  <select value={String(draft.plan)} onChange={e => setDraft({ ...draft, plan: e.target.value })} className={inp}>
                    {[...new Set([String(draft.plan), ...plans])].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Labelled>
                <Labelled label="Status">
                  <select value={String(draft.status)} onChange={e => setDraft({ ...draft, status: e.target.value })} className={inp}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Labelled>
                <Labelled label="Payment">
                  <select value={String(draft.paymentStatus)} onChange={e => setDraft({ ...draft, paymentStatus: e.target.value })} className={inp}>
                    {PAYMENTS.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </Labelled>
                <Labelled label="Trial ends">
                  <input type="date" value={String(draft.trialEndsAt ?? "").slice(0, 10)}
                    onChange={e => setDraft({ ...draft, trialEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inp} />
                </Labelled>
                <Labelled label={`Amount (${t.currency}, in paise/cents)`}>
                  <input type="number" value={Number(draft.amountCents) || 0} onChange={e => setDraft({ ...draft, amountCents: Number(e.target.value) })} className={inp} />
                </Labelled>
                <Labelled label="Currency">
                  <input value={String(draft.currency ?? "INR")} onChange={e => setDraft({ ...draft, currency: e.target.value })} className={inp} />
                </Labelled>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[12px]">
                <span className="text-ink-600">Currently {money(t.amountCents, t.currency)}/mo · trial {t.trialEndsAt ? until(t.trialEndsAt) : "—"}</span>
                <div className="flex gap-1">
                  <Badge tone={STATUS_TONE[t.status] ?? "muted"}>{t.status}</Badge>
                  <Badge tone={PAYMENT_TONE[t.paymentStatus] ?? "muted"}>{t.paymentStatus.replace("_", " ")}</Badge>
                </div>
              </div>
              <Labelled label="Owner notes" className="mt-3">
                <textarea rows={3} value={String(draft.notes ?? "")} onChange={e => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Context for whoever picks this account up next…" className={inp} />
              </Labelled>

              <div className="mt-4 pt-3 border-t border-line">
                <button
                  onClick={() => setConfirm({
                    title: "Delete this tenant",
                    confirmLabel: "Delete permanently",
                    requireTyping: (t.company || t.name) as string,
                    message: <>This permanently removes <b>{label}</b> and everything in it. Type the name exactly to confirm.</>,
                    onConfirm: async () => {
                      const r = await fetch("/api/owner/tenants", {
                        method: "DELETE", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: t.id, confirmName: t.company || t.name }),
                      });
                      const j = await r.json();
                      if (!r.ok || j.error) throw new Error(j.error || "Delete failed");
                      onChanged(); onClose();
                    },
                  })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> Delete tenant
                </button>
              </div>
            </Panel>
          )}

          {tab === "features" && (
            <Panel title="Entitlements" action={
              <button onClick={save} disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            }>
              <label className="flex items-start gap-2 mb-3 pb-3 border-b border-line cursor-pointer">
                <input type="checkbox" checked={!!draft.grandfathered}
                  onChange={e => setDraft({ ...draft, grandfathered: e.target.checked })}
                  className="accent-brand-700 mt-0.5" />
                <span className="text-[13px]">
                  <b className="text-ink-900">Grandfathered</b>
                  <span className="block text-[11px] text-ink-600">Every feature stays on regardless of plan. Overrides the switches below.</span>
                </span>
              </label>
              <div className="space-y-1.5">
                {FEATURE_KEYS.map(k => {
                  const on = !!(draft.features as Record<string, boolean>)?.[k];
                  return (
                    <label key={k} className={`flex items-start gap-2 cursor-pointer ${draft.grandfathered ? "opacity-50" : ""}`}>
                      <input type="checkbox" checked={on} disabled={!!draft.grandfathered}
                        onChange={e => setDraft({ ...draft, features: { ...(draft.features as Record<string, boolean>), [k]: e.target.checked } })}
                        className="accent-brand-700 mt-0.5" />
                      <span className="text-[13px] text-ink-900">{FEATURE_META[k]?.label ?? k}</span>
                    </label>
                  );
                })}
              </div>
            </Panel>
          )}

          {tab === "activity" && (
            <Panel title="Owner actions on this account">
              {!d.audit.length && <p className="text-[13px] text-ink-600">Nothing recorded yet.</p>}
              <div className="space-y-2">
                {d.audit.map((a, i) => (
                  <div key={i} className="text-[12px] border-b border-line last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-ink-900">{a.action}</span>
                      <span className="text-ink-400 shrink-0">{ago(a.at)}</span>
                    </div>
                    <p className="text-ink-600">{a.detail || "—"}</p>
                    <p className="text-[10px] text-ink-400 font-mono">{a.actorEmail}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-600 shrink-0">{label}</span>
      <span className="text-ink-900 text-right truncate">{value}</span>
    </div>
  );
}

function Labelled({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em] mb-1">{label}</span>
      {children}
    </label>
  );
}
