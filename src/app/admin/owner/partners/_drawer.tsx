"use client";

// One partner: its deal, its status, the workspaces it owns and every change
// made to it. Adding a workspace searches the whole fleet; the server refuses
// the platform's own workspace, one owned by another partner, or one on a plan
// this partner can't use.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Drawer, Panel, Badge, Spinner, SearchInput, ConfirmDialog, money, ago, useDebounced, type ConfirmCfg } from "../_ui";
import { KIND_LABEL, STATUS_TONE, type BrandSettings, type PartnerRow, type PartnerStatus } from "./_shared";

type Workspace = { id: string; name: string; company: string | null; plan: string; status: string; paymentStatus: string | null; createdAt: string };
type AuditRow = { actor: string; action: string; tenantId: string | null; detail: string; at: string };
type FleetHit = { id: string; name: string; company: string | null; plan: string; status: string };

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ACTION_LABEL: Record<string, string> = {
  "partner.created": "Partner created", "partner.updated": "Details changed", "partner.status": "Status changed",
  "workspace.added": "Workspace added", "workspace.removed": "Workspace removed",
  "workspace.created": "Customer workspace created", "workspace.plan": "Plan changed",
  "workspace.paused": "Workspace paused", "workspace.resumed": "Workspace resumed",
  "staff.invited": "Login invited", "staff.reinvited": "Invitation resent", "staff.joined": "Login set up", "staff.removed": "Login removed",
  "prices.updated": "Prices changed",
  "billing.setup_paid": "Setup fee paid", "billing.recovered": "Bill paid, workspaces resumed", "billing.grace": "Balance short, grace started",
  "billing.suspended": "Workspaces paused for balance", "billing.topup_link": "Payment link created", "billing.razorpay_connected": "Own Razorpay connected",
  "billing.customer_settings": "Customer billing settings", "billing.customer_link": "Customer payment link sent", "billing.customer_paid": "Customer paid",
  "billing.customer_unpaid": "Customer paused for non-payment",
  "domain.added": "Portal domain added", "domain.verified": "Portal domain live", "domain.removed": "Portal domain removed",
  "meta.app_saved": "Meta app saved", "meta.app_on": "Customers moved to the partner's Meta app", "meta.app_off": "Customers moved to Talko's Meta app",
  "meta.webhooks_subscribed": "Meta webhooks set up", "meta.app_ok": "Meta app check passed", "meta.app_problem": "Meta app check failed",
  "email_domain.added": "Sending domain added", "email_domain.verified": "Sending domain verified", "email_domain.removed": "Sending domain removed",
};

export function PartnerDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [partner, setPartner] = useState<PartnerRow | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [hits, setHits] = useState<FleetHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/owner/partners/${id}`);
      const j = await r.json();
      if (!r.ok || j.error) { setError(j.error || `Couldn't load (HTTP ${r.status})`); return; }
      setPartner(j.partner); setWorkspaces(j.workspaces ?? []); setAudit(j.audit ?? []); setError(null);
    } catch { setError("Couldn't reach the server."); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    let live = true;
    fetch(`/api/owner/tenants?q=${encodeURIComponent(query.trim())}&limit=8`).then(r => r.json())
      .then(j => { if (live) setHits((j.tenants ?? []).filter((t: FleetHit) => t.id !== DEFAULT_TENANT_ID)); })
      .catch(() => { if (live) setHits([]); });
    return () => { live = false; };
  }, [query]);

  async function call(url: string, method: string, body: unknown): Promise<string | null> {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return !r.ok || j.error ? (j.error || `Failed (HTTP ${r.status})`) : null;
  }

  async function setStatus(status: PartnerStatus) {
    setBusy(status); setError(null);
    const e = await call(`/api/owner/partners/${id}`, "PATCH", { status });
    setBusy(null);
    if (e) { setError(e); return; }
    await load(); onChanged();
  }

  async function add(tenantId: string) {
    setBusy(tenantId); setError(null);
    const e = await call(`/api/owner/partners/${id}/workspaces`, "POST", { tenantId });
    setBusy(null);
    if (e) { setError(e); return; }
    setQ(""); setHits(null); await load(); onChanged();
  }

  const mine = new Set(workspaces.map(w => w.id));
  const p = partner;

  return (
    <Drawer open onClose={onClose} title={p?.name ?? "Partner"}
      subtitle={p ? <>{KIND_LABEL[p.kind]} · <span className="capitalize">{p.tier}</span> · {p.slug}.thetalko.in</> : null}
      actions={p && <Badge tone={STATUS_TONE[p.status]}><span className="capitalize">{p.status}</span></Badge>}>
      {!p && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {error && <p className="text-xs text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{error}</p>}
      {p && (
        <>
          <Panel title="Status">
            <div className="flex flex-wrap gap-2">
              {p.status === "onboarding" && <StatusButton label="Activate" busy={busy === "active"} onClick={() => setStatus("active")} />}
              {p.status === "active" && <StatusButton label="Pause" busy={busy === "paused"} onClick={() => setStatus("paused")} />}
              {p.status === "paused" && <StatusButton label="Resume" busy={busy === "active"} onClick={() => setStatus("active")} />}
              {p.status === "closed" && <StatusButton label="Reopen" busy={busy === "onboarding"} onClick={() => setStatus("onboarding")} />}
              {p.status !== "closed" && (
                <button disabled={workspaces.length > 0} title={workspaces.length ? "Remove its workspaces first" : undefined}
                  onClick={() => setConfirm({
                    title: `Close ${p.name}?`, message: "The partner stays in the list for the record, but can't be given workspaces until reopened.",
                    confirmLabel: "Close partner", requireTyping: p.slug,
                    onConfirm: async () => { const e = await call(`/api/owner/partners/${id}`, "PATCH", { status: "closed" }); if (e) throw new Error(e); await load(); onChanged(); },
                  })}
                  className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-white">Close</button>
              )}
            </div>
            <p className="text-[11px] text-ink-600 mt-2">Pausing or closing records the decision. From Phase 4, a paused partner&apos;s workspaces pause too.</p>
          </Panel>

          <BillingPanel partnerId={p.id} onChanged={async () => { await load(); onChanged(); }} />

          <AccountsPanel partnerId={p.id} slug={p.slug} />

          <BrandPanel partner={p} onSaved={async () => { await load(); onChanged(); }} />

          <DealPanel partner={p} onSaved={async () => { await load(); onChanged(); }} />

          <DomainsPanel partnerId={p.id} pro={p.tier === "pro"} />

          <MetaAppPanel partnerId={p.id} />

          <Panel title={`Workspaces (${workspaces.length})`}>
            <div className="space-y-3">
              {!workspaces.length && <p className="text-[13px] text-ink-600">No workspaces yet. Find one below to add it.</p>}
              {workspaces.map(w => (
                <div key={w.id} className="flex items-center justify-between gap-3 border border-line rounded-control px-3 py-2 bg-white">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-900 truncate">{w.company || w.name}</p>
                    <p className="text-[11px] text-ink-600">{w.plan} · {w.status} · added {ago(w.createdAt)}</p>
                  </div>
                  <button onClick={() => setConfirm({
                    title: `Remove ${w.company || w.name}?`, message: "It becomes a direct Talko workspace again. Nothing inside it changes.",
                    confirmLabel: "Remove",
                    onConfirm: async () => { const e = await call(`/api/owner/partners/${id}/workspaces`, "DELETE", { tenantId: w.id }); if (e) throw new Error(e); await load(); onChanged(); },
                  })} aria-label="Remove workspace" className="p-1.5 rounded-control text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {p.status !== "closed" && (
                <div className="space-y-2 pt-1">
                  <SearchInput value={q} onChange={setQ} placeholder="Find a workspace by name, email or phone" />
                  {hits && !hits.length && <p className="text-[12px] text-ink-600">No matching workspace.</p>}
                  {hits?.map(t => {
                    const allowed = p.allowedPlans.includes(t.plan);
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-control bg-canvas">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-900 truncate">{t.company || t.name}</p>
                          <p className="text-[11px] text-ink-600">{t.plan}{!allowed && " · this partner can't use this plan"}</p>
                        </div>
                        {mine.has(t.id)
                          ? <span className="text-[11px] font-bold text-ink-400">Already added</span>
                          : <button onClick={() => add(t.id)} disabled={!allowed || busy === t.id}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[11px] font-bold disabled:opacity-50">
                              <Plus className="w-3 h-3" /> {busy === t.id ? "Adding…" : "Add"}
                            </button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="History">
            {!audit.length ? <p className="text-[13px] text-ink-600">Nothing yet.</p> : (
              <ul className="space-y-2">
                {audit.map((a, i) => (
                  <li key={i} className="text-[12px] text-ink-700">
                    <span className="font-bold text-ink-900">{ACTION_LABEL[a.action] ?? a.action}</span>
                    {a.detail && <span className="text-ink-600"> · {a.detail}</span>}
                    <span className="text-ink-400"> · {a.actor} · {ago(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
      {confirm && <ConfirmDialog cfg={confirm} onDone={() => setConfirm(null)} />}
    </Drawer>
  );
}

function StatusButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : label}</button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-ink-600">{k}</dt><dd className="text-ink-900 font-semibold text-right">{v}</dd></>);
}

// What the partner's portal shows instead of Talko. The preview is the sidebar
// header their customers will see. Saved settings reach the live portal within
// a minute (the brand is cached for 60 seconds).
const BRAND_FIELDS: { key: keyof BrandSettings; label: string; placeholder: string }[] = [
  { key: "displayName", label: "Name shown to customers", placeholder: "Defaults to the partner's name" },
  { key: "logoUrl", label: "Logo image link (https)", placeholder: "https://…/logo.png" },
  { key: "color", label: "Brand colour", placeholder: "#0d6efd" },
  { key: "tagline", label: "Tagline under the logo", placeholder: "Optional" },
  { key: "supportEmail", label: "Support email customers see", placeholder: "Defaults to the contact email" },
  { key: "termsUrl", label: "Terms link (https)", placeholder: "Optional" },
  { key: "privacyUrl", label: "Privacy policy link (https)", placeholder: "Optional" },
];

function BrandPanel({ partner, onSaved }: { partner: PartnerRow; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<BrandSettings>(partner.brand ?? {});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => { setForm(partner.brand ?? {}); }, [partner.brand]);
  useEffect(() => { setLogoFailed(false); }, [form.logoUrl]);

  async function save() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch(`/api/owner/partners/${partner.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand: form }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setNote({ ok: false, text: j.error || `Couldn't save (HTTP ${r.status})` });
      else { setNote({ ok: true, text: "Saved. The portal shows it within a minute." }); await onSaved(); }
    } catch { setNote({ ok: false, text: "Couldn't reach the server." }); }
    finally { setBusy(false); }
  }

  const name = form.displayName?.trim() || partner.name;
  const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900";
  return (
    <Panel title="Brand" action={<a href={`https://${partner.slug}.thetalko.in`} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-700 hover:underline">{partner.slug}.thetalko.in ↗</a>}>
      <div className="space-y-3">
        <div className="rounded-control border border-line bg-white px-4 py-3">
          <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wide mb-2">Preview</p>
          {form.logoUrl && !logoFailed
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={form.logoUrl} alt={name} style={{ height: 28, width: "auto" }} onError={() => setLogoFailed(true)} />
            : <p className="text-[15px] font-extrabold" style={{ color: form.color || undefined }}>{name}</p>}
          {form.tagline && <p className="text-[10px] text-ink-400 mt-1.5">{form.tagline}</p>}
          {form.logoUrl && logoFailed && <p className="text-[11px] text-amber-700 mt-1">That logo link doesn&apos;t load an image.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {BRAND_FIELDS.map(f => (
            <label key={f.key} className={f.key === "logoUrl" || f.key === "tagline" ? "col-span-2" : ""}>
              <span className="block text-[11px] font-bold text-ink-600 mb-1">{f.label}</span>
              <input className={inp} value={form[f.key] ?? ""} placeholder={f.placeholder}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save brand"}</button>
          {note && <p className={`text-[12px] ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
        </div>
        <p className="text-[11px] text-ink-600">
          {partner.tier === "pro" ? "Pro: no \"Powered by Talko\" line on their website chat." : "Standard: their website chat keeps a small \"Powered by Talko AI\" line."}
        </p>
      </div>
    </Panel>
  );
}

// The partner's own dashboard logins. You invite the first owner here; from
// then on the partner's owners invite and remove their own staff.
type Account = { id: string; email: string; name: string; role: "owner" | "staff"; invitePending: boolean; lastLoginAt: string | null };

function AccountsPanel({ partnerId, slug }: { partnerId: string; slug: string }) {
  const [users, setUsers] = useState<Account[] | null>(null);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/owner/partners/${partnerId}/users`);
    const j = await r.json().catch(() => ({}));
    if (j.setupNeeded) { setSetupNeeded(j.error); setUsers([]); return; }
    setUsers(j.users ?? []);
  }, [partnerId]);
  useEffect(() => { load(); }, [load]);

  async function invite(body: Record<string, string>, done: string) {
    setBusy(true); setNote(null);
    const r = await fetch(`/api/owner/partners/${partnerId}/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { setNote({ ok: false, text: j.error || `Failed (HTTP ${r.status})` }); return; }
    setNote({ ok: true, text: done }); setEmail(""); setName(""); load();
  }

  const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900";
  return (
    <Panel title="Partner dashboard logins" action={<span className="text-[11px] text-ink-600">{slug}.thetalko.in/partner</span>}>
      {setupNeeded ? <p className="text-[12px] text-amber-700">{setupNeeded}</p> : !users ? <Spinner /> : (
        <div className="space-y-3">
          {!users.length && <p className="text-[13px] text-ink-600">No logins yet. Invite the partner&apos;s first owner; they invite their own staff after that.</p>}
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate"><b className="text-ink-900">{u.name || u.email}</b> <span className="text-ink-400">{u.name ? u.email : ""} · {u.role}</span></span>
              {u.invitePending
                ? <button onClick={() => invite({ resend: u.id }, `A new link was sent to ${u.email}.`)} className="text-[11px] font-bold text-brand-700 hover:underline shrink-0">Invited · resend</button>
                : <span className="text-[11px] text-ink-400 shrink-0">{u.lastLoginAt ? `last in ${ago(u.lastLoginAt)}` : "active"}</span>}
            </div>
          ))}
          <div className="grid grid-cols-5 gap-2 pt-1">
            <input className={`${inp} col-span-2`} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
            <input className={`${inp} col-span-3`} type="email" placeholder="Owner's email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => invite({ email, name }, `Invitation sent to ${email}.`)} disabled={busy || !email}
              className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Sending…" : "Invite an owner"}</button>
            {note && <p className={`text-[12px] ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

// Prepaid balance (white-label Phase 4). A credit here, e.g. a bank transfer
// you received, pays the setup fee and any overdue month, then resumes.
type LedgerLine = { kind: string; amountCents: number; balanceAfterCents: number; description: string; at: string };
type BillingInfo = { balanceCents: number; depositCents: number; availableCents: number; state: string; graceUntil: string | null; setupPaidAt: string | null; setupFeeCents: number; billingDay: number; ledger: LedgerLine[] };

function BillingPanel({ partnerId, onChanged }: { partnerId: string; onChanged: () => Promise<void> }) {
  const [b, setB] = useState<BillingInfo | null>(null);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/owner/partners/${partnerId}/billing`);
    const j = await r.json().catch(() => ({}));
    if (j.setupNeeded) { setSetupNeeded(j.error); return; }
    if (r.ok) setB(j);
  }, [partnerId]);
  useEffect(() => { load(); }, [load]);

  async function adjust(sign: 1 | -1) {
    setBusy(true); setNote(null);
    const cents = Math.round((Number(amount.replace(/[,\s₹]/g, "")) || 0) * 100) * sign;
    const r = await fetch(`/api/owner/partners/${partnerId}/billing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountCents: cents, description: why }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { setNote({ ok: false, text: j.error || `Failed (HTTP ${r.status})` }); return; }
    setNote({ ok: true, text: sign > 0 ? "Credited." : "Debited." }); setAmount(""); setWhy(""); await load(); await onChanged();
  }

  const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900";
  const tone = b?.state === "ok" ? "ok" : b?.state === "grace" ? "warn" : "bad";
  return (
    <Panel title="Prepaid balance" action={b && <Badge tone={tone}><span className="capitalize">{b.state === "ok" ? "In good standing" : b.state === "grace" ? "Short, in grace" : "Paused for balance"}</span></Badge>}>
      {setupNeeded ? <p className="text-[12px] text-amber-700">{setupNeeded}</p> : !b ? <Spinner /> : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            <Row k="Balance" v={money(b.balanceCents)} />
            <Row k="Available (after deposit)" v={money(b.availableCents)} />
            <Row k="Setup fee" v={b.setupPaidAt ? `Paid ${ago(b.setupPaidAt)}` : `${money(b.setupFeeCents)} due`} />
            <Row k="Billing day" v={`${b.billingDay} of each month`} />
            {b.graceUntil && b.state === "grace" && <Row k="Grace ends" v={new Date(b.graceUntil).toLocaleDateString("en-IN")} />}
          </dl>
          <div className="grid grid-cols-5 gap-2">
            <input className={`${inp} col-span-2`} inputMode="numeric" placeholder="₹ amount" value={amount} onChange={e => setAmount(e.target.value)} />
            <input className={`${inp} col-span-3`} placeholder="Reason, e.g. NEFT received 30 Oct" value={why} onChange={e => setWhy(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => adjust(1)} disabled={busy || !amount || !why} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">Credit</button>
            <button onClick={() => adjust(-1)} disabled={busy || !amount || !why} className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60">Debit</button>
            {note && <p className={`text-[12px] ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
          </div>
          {!!b.ledger.length && (
            <ul className="space-y-1 max-h-48 overflow-y-auto border-t border-line pt-2">
              {b.ledger.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 text-[12px]">
                  <span className="truncate text-ink-700">{l.description || l.kind} <span className="text-ink-400">· {ago(l.at)}</span></span>
                  <span className={`tabular-nums shrink-0 ${l.amountCents >= 0 ? "text-emerald-700 font-bold" : "text-ink-900"}`}>{l.amountCents >= 0 ? "+" : "−"}{money(Math.abs(l.amountCents))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

// The deal: fees, share, plans, grace and billing day, editable at any time.
// Changes apply from the next charge; nothing already charged is recalculated.
function DealPanel({ partner, onSaved }: { partner: PartnerRow; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [plans, setPlans] = useState<{ key: string; name: string }[]>([]);
  const toR = (c: number) => String(Math.round(c / 100));
  const [f, setF] = useState({
    setup: toR(partner.setupFeeCents), monthly: toR(partner.monthlyFeeCents), deposit: toR(partner.depositCents),
    pct: String(partner.wholesalePct ?? ""), grace: String(partner.graceDays), day: String(partner.billingDay ?? 1),
    yt: String(partner.ytDailyCap ?? 300), allowed: partner.allowedPlans,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!editing || plans.length) return;
    fetch("/api/owner/plans").then(r => r.json()).then(j => setPlans((j.plans ?? []).filter((p: { key: string }) => p.key !== "trial"))).catch(() => {});
  }, [editing, plans.length]);

  async function save() {
    setBusy(true); setNote(null);
    const cents = (v: string) => Math.round((Number(v.replace(/[,\s₹]/g, "")) || 0) * 100);
    const body: Record<string, unknown> = {
      setupFeeCents: cents(f.setup), monthlyFeeCents: cents(f.monthly), depositCents: cents(f.deposit),
      graceDays: Number(f.grace), billingDay: Number(f.day), ytDailyCap: Number(f.yt), allowedPlans: f.allowed,
    };
    if (partner.kind === "reseller") body.wholesalePct = Number(f.pct);
    const r = await fetch(`/api/owner/partners/${partner.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { setNote({ ok: false, text: j.error || `Failed (HTTP ${r.status})` }); return; }
    setNote({ ok: true, text: "Saved. Applies from the next charge." }); setEditing(false); await onSaved();
  }

  const inp = "w-full border border-line rounded-control px-3 py-1.5 text-sm bg-white text-ink-900";
  const field = (label: string, key: keyof typeof f, suffix?: string) => (
    <label className="text-[12px]"><span className="block font-bold text-ink-600 mb-1">{label}</span>
      <span className="flex items-center gap-1"><input className={inp} inputMode="numeric" value={f[key] as string} onChange={e => setF({ ...f, [key]: e.target.value })} />{suffix && <span className="text-ink-600 shrink-0">{suffix}</span>}</span>
    </label>
  );
  return (
    <Panel title="Deal" action={!editing && <button onClick={() => setEditing(true)} className="text-[11px] font-bold text-brand-700 hover:underline">Edit</button>}>
      {!editing ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <Row k="Setup fee" v={money(partner.setupFeeCents)} />
          <Row k={partner.kind === "private" ? "Brand fee, monthly" : "Platform fee, monthly"} v={money(partner.monthlyFeeCents)} />
          <Row k="Deposit" v={money(partner.depositCents)} />
          {partner.kind === "reseller" && <Row k="Wholesale" v={`${partner.wholesalePct ?? 0}% of list price`} />}
          <Row k="Grace before pause" v={`${partner.graceDays} days`} />
          <Row k="Billing day" v={`${partner.billingDay ?? 1} of each month`} />
          <Row k="YouTube replies a day" v={partner.ytDailyCap ? String(partner.ytDailyCap) : "No partner cap"} />
          <Row k="Plans" v={partner.allowedPlans.join(", ") || "None"} />
          <Row k="Contact" v={[partner.contactName, partner.contactEmail, partner.contactPhone].filter(Boolean).join(" · ") || "Not set"} />
        </dl>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {field("Setup fee", "setup", "₹")}
            {field(partner.kind === "private" ? "Brand fee / month" : "Platform fee / month", "monthly", "₹")}
            {field("Deposit", "deposit", "₹")}
            {partner.kind === "reseller" && field("Wholesale share", "pct", "%")}
            {field("Grace days", "grace")}
            {field("Billing day (1–28)", "day")}
            {field("YouTube replies / day", "yt")}
          </div>
          <div className="flex flex-wrap gap-2">
            {plans.map(p => {
              const on = f.allowed.includes(p.key);
              return <button key={p.key} type="button" onClick={() => setF({ ...f, allowed: on ? f.allowed.filter(x => x !== p.key) : [...f.allowed, p.key] })}
                className={`px-3 py-1 rounded-full border text-xs font-bold ${on ? "bg-brand-50 text-brand-700 border-brand-100" : "bg-white text-ink-600 border-line"}`}>{p.name}</button>;
            })}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save deal"}</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs font-bold text-ink-600">Cancel</button>
          </div>
        </div>
      )}
      {note && <p className={`text-[12px] mt-2 ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
    </Panel>
  );
}

// The partner's own portal domain (Vercel) and sending domain (Resend).
type DomainInfo = {
  portal: { domain: string | null; status: string; detail: { records?: { type: string; name: string; value: string }[]; problem?: string | null; checkedAt?: string } };
  email: { name: string | null; status: string | null; records: { record?: string; name?: string; type?: string; value?: string; status?: string }[] };
  vercel: boolean; resend: boolean;
};

function DomainsPanel({ partnerId, pro }: { partnerId: string; pro: boolean }) {
  const [d, setD] = useState<DomainInfo | null>(null);
  const [portal, setPortal] = useState("");
  const [mail, setMail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/owner/partners/${partnerId}/domains`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote({ ok: false, text: j.error || "Couldn't load domains." }); return; }
    setD(j);
  }, [partnerId]);
  useEffect(() => { load(); }, [load]);
  async function act(method: string, body: Record<string, unknown>, key: string, done: string) {
    setBusy(key); setNote(null);
    const r = await fetch(`/api/owner/partners/${partnerId}/domains`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.error) { setNote({ ok: false, text: j.error || `Failed (HTTP ${r.status})` }); return; }
    setNote({ ok: true, text: done }); await load();
  }
  const inp = "w-full border border-line rounded-control px-3 py-1.5 text-sm bg-white text-ink-900";
  const statusTone = (s: string | null) => s === "verified" ? "ok" : s === "error" || s === "failed" ? "bad" : "warn";
  const records = (rows: { type?: string; name?: string; value?: string }[]) => (
    <table className="w-full text-[11px] mt-2"><tbody>
      {rows.map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1 pr-2 font-bold">{r.type}</td><td className="py-1 pr-2 break-all">{r.name}</td><td className="py-1 break-all font-mono">{r.value}</td></tr>)}
    </tbody></table>
  );
  return (
    <Panel title="Own domains" action={!pro && <span className="text-[11px] text-ink-600">Usually a Pro feature</span>}>
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          <div>
            <p className="text-[12px] font-bold text-ink-900 mb-1">Portal address {d.portal.domain && <Badge tone={statusTone(d.portal.status)}>{d.portal.status}</Badge>}</p>
            {!d.vercel && <p className="text-[12px] text-amber-700">Needs VERCEL_TOKEN and VERCEL_PROJECT_ID in Vercel&apos;s environment.</p>}
            {d.portal.domain ? (
              <>
                <p className="text-[13px] text-ink-700">{d.portal.domain}{d.portal.detail.problem ? <span className="text-amber-700"> · {d.portal.detail.problem}</span> : ""}</p>
                {d.portal.status !== "verified" && d.portal.detail.records && records(d.portal.detail.records)}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => act("POST", { kind: "portal", recheck: true }, "pc", "Checked.")} disabled={busy === "pc"} className="px-3 py-1 rounded-control border border-line bg-white text-xs font-bold hover:bg-canvas">Check now</button>
                  <button onClick={() => act("DELETE", { kind: "portal" }, "pr", "Removed.")} disabled={busy === "pr"} className="px-3 py-1 rounded-control border border-line bg-white text-xs font-bold text-red-600 hover:bg-red-50">Remove</button>
                </div>
              </>
            ) : (
              <div className="flex gap-2"><input className={inp} placeholder="portal.theirbrand.com" value={portal} onChange={e => setPortal(e.target.value)} />
                <button onClick={() => act("POST", { kind: "portal", domain: portal }, "pa", "Added. Ask the partner to add the DNS record shown.")} disabled={!portal || busy === "pa" || !d.vercel} className="px-3 py-1.5 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-60 shrink-0">Add</button></div>
            )}
          </div>
          <div className="border-t border-line pt-3">
            <p className="text-[12px] font-bold text-ink-900 mb-1">Sending domain {d.email.name && <Badge tone={statusTone(d.email.status)}>{d.email.status ?? "pending"}</Badge>}</p>
            {!d.resend && <p className="text-[12px] text-amber-700">Needs RESEND_API_KEY.</p>}
            {d.email.name ? (
              <>
                <p className="text-[13px] text-ink-700">Emails to their customers go from no-reply@{d.email.name}{d.email.status === "verified" ? "" : " once verified"}.</p>
                {d.email.status !== "verified" && records(d.email.records)}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => act("POST", { kind: "email", recheck: true }, "ec", "Checked.")} disabled={busy === "ec"} className="px-3 py-1 rounded-control border border-line bg-white text-xs font-bold hover:bg-canvas">Check now</button>
                  <button onClick={() => act("DELETE", { kind: "email" }, "er", "Removed.")} disabled={busy === "er"} className="px-3 py-1 rounded-control border border-line bg-white text-xs font-bold text-red-600 hover:bg-red-50">Remove</button>
                </div>
              </>
            ) : (
              <div className="flex gap-2"><input className={inp} placeholder="theirbrand.com" value={mail} onChange={e => setMail(e.target.value)} />
                <button onClick={() => act("POST", { kind: "email", domain: mail }, "ea", "Added. Ask the partner to add the DNS records shown.")} disabled={!mail || busy === "ea" || !d.resend} className="px-3 py-1.5 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-60 shrink-0">Add</button></div>
            )}
          </div>
          {note && <p className={`text-[12px] ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
        </div>
      )}
    </Panel>
  );
}

// The partner's own Meta app (Phase 5). Talko keeps the switch: credentials are
// saved here or by the partner, but only the owner turns the app on, sets up
// its webhooks, and the daily check reports here.
type MetaApp = { appId: string | null; igAppId: string | null; fbConfigId: string | null; active: boolean; status: "none" | "ok" | "problem"; problems: string[]; checkedAt: string | null; hasSecrets: boolean };
type MetaSetup = { instagramRedirects: string[]; jsSdkDomains: string[]; webhooks: Record<string, string>; verifyToken: string | null; adminCheck: boolean };

const Codes = ({ items }: { items: string[] }) => <>{items.map((x, i) => <span key={x}>{i > 0 && " and "}<code className="break-all">{x}</code></span>)}</>;

function MetaAppPanel({ partnerId }: { partnerId: string }) {
  const [app, setApp] = useState<MetaApp | null>(null);
  const [setup, setSetup] = useState<MetaSetup | null>(null);
  const [f, setF] = useState({ appId: "", appSecret: "", igAppId: "", igAppSecret: "", fbConfigId: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`/api/owner/partners/${partnerId}/meta`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote({ ok: false, text: j.error || "Couldn't load." }); return; }
    setApp(j.app); setSetup(j.setup);
    setF(x => ({ ...x, appId: j.app.appId ?? "", igAppId: j.app.igAppId ?? "", fbConfigId: j.app.fbConfigId ?? "" }));
  }, [partnerId]);
  useEffect(() => { load(); }, [load]);
  async function post(body: Record<string, unknown>, key: string, done: (j: Record<string, unknown>) => string) {
    setBusy(key); setNote(null);
    const r = await fetch(`/api/owner/partners/${partnerId}/meta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.error) { setNote({ ok: false, text: j.error || `Failed (HTTP ${r.status})` }); return; }
    setNote({ ok: true, text: done(j) }); await load();
  }
  const inp = "w-full border border-line rounded-control px-3 py-1.5 text-sm bg-white text-ink-900";
  const tone = app?.status === "ok" ? "ok" : app?.status === "problem" ? "bad" : "muted";
  return (
    <Panel title="Own Meta app" action={app && <Badge tone={app.active ? tone : "muted"}>{app.active ? (app.status === "problem" ? "On · problem" : "On") : app.hasSecrets ? "Saved, off" : "Not set up"}</Badge>}>
      {!app || !setup ? <Spinner /> : (
        <div className="space-y-3 text-[13px]">
          <p className="text-ink-600">With it on, this partner&apos;s customers connect Instagram and Facebook Pages through the partner&apos;s app, so Meta&apos;s screens show the partner&apos;s name. WhatsApp and Meta Ads always use Talko&apos;s app. Switching off affects new connections; ones already made keep working.</p>
          {app.problems.length > 0 && <ul className="list-disc pl-4 text-red-600 text-[12px]">{app.problems.map(x => <li key={x}>{x}</li>)}</ul>}
          {app.hasSecrets && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => post({ active: !app.active }, "act", () => app.active ? "Switched off: customers connect through Talko's app." : "Switched on.")} disabled={busy === "act"}
                className={`px-3 py-1.5 rounded-control text-xs font-bold ${app.active ? "border border-line bg-white text-ink-700 hover:bg-canvas" : "bg-brand-700 text-white hover:bg-brand-600"}`}>{app.active ? "Move customers back to Talko's app" : "Switch on"}</button>
              <button onClick={() => post({ subscribe: true }, "sub", j => ((j.results as { object: string; ok: boolean }[]) ?? []).map(r => `${r.object} ${r.ok ? "✓" : "✗"}`).join(" · "))} disabled={busy === "sub"} className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold hover:bg-canvas">Set up webhooks</button>
              <button onClick={() => post({ check: true }, "chk", () => "Checked.")} disabled={busy === "chk"} className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold hover:bg-canvas">Check now</button>
              {app.checkedAt && <span className="text-[11px] text-ink-400 self-center">last checked {ago(app.checkedAt)}</span>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="App ID" value={f.appId} onChange={e => setF({ ...f, appId: e.target.value })} />
            <input className={inp} type="password" placeholder={app.hasSecrets ? "App Secret (saved)" : "App Secret"} value={f.appSecret} onChange={e => setF({ ...f, appSecret: e.target.value })} />
            <input className={inp} placeholder="Instagram App ID" value={f.igAppId} onChange={e => setF({ ...f, igAppId: e.target.value })} />
            <input className={inp} type="password" placeholder={app.igAppId ? "Instagram App Secret (saved)" : "Instagram App Secret"} value={f.igAppSecret} onChange={e => setF({ ...f, igAppSecret: e.target.value })} />
            <input className={`${inp} col-span-2`} placeholder="Facebook Login for Business configuration ID (Pages)" value={f.fbConfigId} onChange={e => setF({ ...f, fbConfigId: e.target.value })} />
          </div>
          <button onClick={() => post(f, "save", j => `Saved: ${String(j.appName ?? "app")}. Switch it on when ready.`)} disabled={busy === "save" || !f.appId} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy === "save" ? "Checking with Meta…" : "Save app"}</button>
          <details className="text-[12px] text-ink-600">
            <summary className="cursor-pointer font-bold text-ink-700">What the partner sets in its Meta app</summary>
            <ul className="list-disc pl-4 mt-1 space-y-1">
              <li>Instagram → API setup with Instagram login → redirect URLs: <Codes items={setup.instagramRedirects} /></li>
              <li>Facebook Login for Business → Allowed domains for the JavaScript SDK: <Codes items={setup.jsSdkDomains} />, and a configuration with the Page permissions; its ID goes above.</li>
              <li>App roles → add Talko&apos;s account as an Administrator{setup.adminCheck ? " (checked daily)" : " (set TALKO_META_ADMIN_ID to check it daily)"}.</li>
              <li>Webhooks: Talko sets these with &ldquo;Set up webhooks&rdquo;. If Meta wants one added by hand: <code className="break-all">{setup.webhooks.messenger}</code> (Pages) and <code className="break-all">{setup.webhooks.instagram}</code> (Instagram){setup.verifyToken && <>, verify token <code className="break-all">{setup.verifyToken}</code></>}.</li>
              <li>Meta App Review for the same permissions Talko uses, recorded on the partner&apos;s portal, then Live mode.</li>
            </ul>
          </details>
          {note && <p className={`text-[12px] ${note.ok ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
        </div>
      )}
    </Panel>
  );
}
