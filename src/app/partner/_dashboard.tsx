"use client";

// The partner dashboard. One screen, five tabs: Overview, Customers, Team,
// Brand, and (resellers only) Prices. Everything here is the partner's own:
// the API answers only for this partner's workspaces and accounts.

import { useCallback, useEffect, useState } from "react";
import { LogOut, Plus, Users, Building2, Palette, IndianRupee, LayoutDashboard, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand } from "@/components/BrandContext";
import { Notice, useNotice } from "@/components/Notice";
import { Panel, Table, Th, Td, Badge, MetricTile, Drawer, EmptyState, Spinner, ConfirmDialog, money, ago, type ConfirmCfg, type Tone } from "@/app/admin/owner/_ui";

type Plan = { key: string; name: string; listCents: number; limits: Record<string, number> };
type Me = {
  user: { id: string; email: string; name: string; role: "owner" | "staff" };
  partner: { id: string; name: string; slug: string; kind: "private" | "reseller"; tier: string; status: string; monthlyFeeCents: number; wholesalePct: number | null; brand: Record<string, string | null>; resalePrices: Record<string, number> };
  plans: Plan[];
  estimate: { feeCents: number; workspacesCents: number; totalCents: number; live: number; sharePct: number | null };
};
type Workspace = { id: string; name: string; company: string | null; plan: string; status: string; paymentStatus: string | null; createdAt: string };
type Tab = "overview" | "customers" | "team" | "brand" | "prices";

const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900";
const btn = "px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60";
const WS_TONE: Record<string, Tone> = { active: "ok", trialing: "info", suspended: "warn", cancelled: "muted" };
const WS_LABEL: Record<string, string> = { active: "Active", trialing: "Trial", suspended: "Paused", cancelled: "Closed" };

async function call(url: string, method = "GET", body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { window.location.href = "/partner/login"; return { ok: false, data: {} }; }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && !data.error, data: r.ok ? data : { error: data.error || `Request failed (HTTP ${r.status})` } };
  } catch { return { ok: false, data: { error: "Couldn't reach the server." } }; }
}

export function PartnerDashboard() {
  const brand = useBrand();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [note, say] = useNotice();

  const loadMe = useCallback(async () => {
    const r = await call("/api/partner/me");
    if (r.ok) setMe(r.data as unknown as Me); else say(String(r.data.error));
  }, [say]);
  useEffect(() => { loadMe(); }, [loadMe]);

  async function signOut() {
    await call("/api/partner/logout", "POST");
    window.location.href = "/partner/login";
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" />, show: true },
    { key: "customers", label: me?.partner.kind === "private" ? "Workspaces" : "Customers", icon: <Building2 className="w-4 h-4" />, show: true },
    { key: "team", label: "Team", icon: <Users className="w-4 h-4" />, show: true },
    { key: "brand", label: "Brand", icon: <Palette className="w-4 h-4" />, show: true },
    { key: "prices", label: "Prices", icon: <IndianRupee className="w-4 h-4" />, show: me?.partner.kind === "reseller" },
  ];
  const owner = me?.user.role === "owner";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo height={28} className="max-w-[160px]" fallback={<span className="font-extrabold text-ink-900">{brand.name}</span>} />
            <span className="text-[12px] font-bold text-ink-400 uppercase tracking-wide hidden sm:inline">Partner dashboard</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {me && <span className="text-[12px] text-ink-600 hidden sm:inline">{me.user.email} · {me.user.role === "owner" ? "Owner" : "Staff"}</span>}
            <button onClick={signOut} className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {tabs.filter(t => t.show).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-bold border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? "border-brand-700 text-ink-900" : "border-transparent text-ink-600 hover:text-ink-900"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <Notice notice={note} variant="banner" onClose={() => say(null)} />
        {!me ? <div className="flex justify-center py-16"><Spinner /></div> : (
          <>
            {me.partner.status === "paused" && <Notice variant="banner" notice={{ tone: "warn", text: "Your partner account is paused. Your customers' workspaces keep their data. Contact Talko to resume." }} />}
            {tab === "overview" && <Overview me={me} goTo={setTab} />}
            {tab === "customers" && <Customers me={me} onChanged={loadMe} />}
            {tab === "team" && <Team me={me} owner={owner} />}
            {tab === "brand" && <BrandTab me={me} owner={owner} onSaved={loadMe} />}
            {tab === "prices" && me.partner.kind === "reseller" && <Prices me={me} owner={owner} onSaved={loadMe} />}
          </>
        )}
      </main>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({ me, goTo }: { me: Me; goTo: (t: Tab) => void }) {
  const e = me.estimate;
  const reseller = me.partner.kind === "reseller";
  const steps: { done: boolean; text: string; tab: Tab }[] = [
    { done: !!me.partner.brand?.logoUrl, text: "Add your logo so customers see your brand", tab: "brand" },
    ...(reseller ? [{ done: Object.keys(me.partner.resalePrices ?? {}).length > 0, text: "Set the price you charge for each plan", tab: "prices" as Tab }] : []),
    { done: e.live > 0, text: reseller ? "Add your first customer" : "Add your first workspace", tab: "customers" },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile label={reseller ? "Live customers" : "Live workspaces"} value={String(e.live)} />
        <MetricTile label={reseller ? "Platform fee" : "Brand fee"} value={money(e.feeCents)} sub="per month" />
        <MetricTile label="Workspaces" value={money(e.workspacesCents)} sub={reseller && e.sharePct != null ? `at ${e.sharePct}% of list price` : "plan prices"} />
        <MetricTile label="Estimated this month" value={money(e.totalCents)} sub="before GST, paid to Talko" />
      </div>
      <Panel title="Next steps">
        <ul className="space-y-2">
          {steps.map(s => (
            <li key={s.text} className="flex items-center justify-between gap-3">
              <span className={`text-sm ${s.done ? "text-ink-400 line-through" : "text-ink-900"}`}>{s.text}</span>
              {!s.done && <button onClick={() => goTo(s.tab)} className="text-[12px] font-bold text-brand-700 hover:underline">Do it</button>}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="text-[12px] text-ink-600">The estimate counts every workspace that isn&apos;t paused. Billing from this dashboard starts in a later update; until then Talko invoices you directly.</p>
    </div>
  );
}

// ── Customers ───────────────────────────────────────────────────────────────

function Customers({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [rows, setRows] = useState<Workspace[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, say] = useNotice();
  const load = useCallback(async () => {
    const r = await call("/api/partner/workspaces");
    if (r.ok) setRows((r.data.workspaces as Workspace[]) ?? []); else say(String(r.data.error));
  }, [say]);
  useEffect(() => { load(); }, [load]);
  const planName = (k: string) => me.plans.find(p => p.key === k)?.name ?? k;
  const noun = me.partner.kind === "private" ? "workspace" : "customer";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600">Every {noun} gets its own workspace, in your brand.</p>
        <div className="flex gap-2">
          <button onClick={load} className="p-1.5 rounded-control border border-line bg-white text-ink-600 hover:bg-canvas" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setAdding(true)} className={`${btn} flex items-center gap-1.5`}><Plus className="w-3.5 h-3.5" /> Add {noun}</button>
        </div>
      </div>
      <Notice notice={note} variant="banner" onClose={() => say(null)} />
      <Panel dense>
        {!rows ? <div className="flex justify-center py-10"><Spinner /></div>
          : !rows.length ? <EmptyState icon={<Building2 className="w-5 h-5" />} title={`No ${noun}s yet`} body={`Add a ${noun}: they get an email to set their password and sign in.`} />
          : (
            <Table head={<tr><Th>{noun === "customer" ? "Customer" : "Workspace"}</Th><Th>Plan</Th><Th>Status</Th><Th align="right">Added</Th></tr>}>
              {rows.map(w => (
                <tr key={w.id} className="hover:bg-canvas cursor-pointer" onClick={() => setOpenId(w.id)}>
                  <Td><span className="font-bold text-ink-900">{w.company || w.name}</span></Td>
                  <Td>{planName(w.plan)}</Td>
                  <Td><Badge tone={WS_TONE[w.status] ?? "muted"}>{WS_LABEL[w.status] ?? w.status}</Badge></Td>
                  <Td align="right">{ago(w.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
      </Panel>
      {adding && <AddWorkspace me={me} noun={noun} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); say(`${noun === "customer" ? "Customer" : "Workspace"} added. They've been emailed a link to set their password.`, "ok"); load(); onChanged(); }} />}
      {openId && <WorkspaceDrawer me={me} id={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged(); }} />}
    </div>
  );
}

function AddWorkspace({ me, noun, onClose, onCreated }: { me: Me; noun: string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ company: "", ownerName: "", ownerEmail: "", ownerPhone: "", plan: me.plans[0]?.key ?? "" });
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();
  async function create() {
    setBusy(true); say(null);
    const r = await call("/api/partner/workspaces", "POST", f);
    setBusy(false);
    if (r.ok) onCreated(); else say(String(r.data.error));
  }
  const label = "block text-[11px] font-bold text-ink-600 mb-1";
  const yourPrice = (k: string) => me.partner.resalePrices?.[k];
  return (
    <Drawer open onClose={onClose} title={`Add ${noun}`} subtitle="They get an email with a link to set their password."
      actions={<button onClick={create} disabled={busy} className={btn}>{busy ? "Adding…" : `Add ${noun}`}</button>}>
      <Panel>
        <div className="space-y-3">
          <div><label className={label}>Business name</label><input className={inp} value={f.company} onChange={e => setF({ ...f, company: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Contact person</label><input className={inp} value={f.ownerName} onChange={e => setF({ ...f, ownerName: e.target.value })} /></div>
            <div><label className={label}>Phone (optional)</label><input className={inp} value={f.ownerPhone} onChange={e => setF({ ...f, ownerPhone: e.target.value })} /></div>
          </div>
          <div><label className={label}>Their email (they sign in with this)</label><input className={inp} type="email" value={f.ownerEmail} onChange={e => setF({ ...f, ownerEmail: e.target.value })} /></div>
          <div>
            <label className={label}>Plan</label>
            <div className="grid grid-cols-1 gap-2">
              {me.plans.map(p => (
                <button key={p.key} type="button" onClick={() => setF({ ...f, plan: p.key })}
                  className={`text-left rounded-control border px-3 py-2 ${f.plan === p.key ? "border-brand-500 bg-brand-50" : "border-line bg-white hover:border-slate-300"}`}>
                  <span className="text-sm font-bold text-ink-900">{p.name}</span>
                  <span className="text-[12px] text-ink-600"> · {me.partner.kind === "reseller" && yourPrice(p.key) ? `you charge ${money(yourPrice(p.key)!)}` : `${money(p.listCents)} list`} a month</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      <Notice notice={note} />
    </Drawer>
  );
}

const LIMIT_ROWS: { key: string; usage: string; label: string }[] = [
  { key: "contacts", usage: "contacts", label: "Contacts" },
  { key: "conversations_per_month", usage: "conversations", label: "Conversations this month" },
  { key: "messages_per_month", usage: "messages", label: "Messages this month" },
  { key: "channels", usage: "channels", label: "Channels" },
  { key: "team_seats", usage: "seats", label: "Team seats" },
];

function WorkspaceDrawer({ me, id, onClose, onChanged }: { me: Me; id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<{ workspace: Workspace; limits: Record<string, number>; usage: Record<string, number> | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [note, say] = useNotice();
  const load = useCallback(async () => {
    const r = await call(`/api/partner/workspaces/${id}`);
    if (r.ok) setD(r.data as never); else say(String(r.data.error));
  }, [id, say]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: unknown, done: string) {
    const r = await call(`/api/partner/workspaces/${id}`, "PATCH", body);
    if (!r.ok) { say(String(r.data.error)); return; }
    say(done, "ok"); await load(); onChanged();
  }
  const w = d?.workspace;
  const paused = w?.status === "suspended";
  return (
    <Drawer open onClose={onClose} title={w ? (w.company || w.name) : "Workspace"} subtitle={w ? <Badge tone={WS_TONE[w.status] ?? "muted"}>{WS_LABEL[w.status] ?? w.status}</Badge> : null}>
      <Notice notice={note} />
      {!d ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <>
          <Panel title="Plan">
            <div className="flex items-center gap-2">
              <select className={inp} value={d.workspace.plan} onChange={e => patch({ plan: e.target.value }, "Plan changed.")}>
                {me.plans.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-ink-600 mt-2">A new plan applies straight away, with its limits and features.</p>
          </Panel>
          <Panel title="Usage against plan limits">
            {!d.usage ? <p className="text-[13px] text-ink-600">Usage isn&apos;t available right now.</p> : (
              <ul className="space-y-3">
                {LIMIT_ROWS.map(r => {
                  const used = d.usage![r.usage] ?? 0, cap = d.limits[r.key] ?? 0;
                  const pct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0;
                  return (
                    <li key={r.key}>
                      <div className="flex justify-between text-[12px]"><span className="text-ink-700">{r.label}</span><span className="text-ink-900 font-semibold tabular-nums">{used.toLocaleString("en-IN")} / {cap > 0 ? cap.toLocaleString("en-IN") : "unlimited"}</span></div>
                      {cap > 0 && <div className="h-1.5 rounded-full bg-canvas mt-1 overflow-hidden"><div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-brand-700"}`} style={{ width: `${pct}%` }} /></div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title={paused ? "Paused" : "Pause"}>
            <p className="text-[13px] text-ink-600 mb-3">{paused
              ? "Sending and automations are stopped. Its users can still sign in and see their data."
              : "Pausing stops sending and automations, for example when a customer hasn't paid you. Nothing is deleted."}</p>
            <button onClick={() => paused ? patch({ paused: false }, "Resumed.") : setConfirm({
              title: `Pause ${w!.company || w!.name}?`, message: "Sending and automations stop until you resume. Its users are told to contact you.",
              confirmLabel: "Pause", onConfirm: async () => { await patch({ paused: true }, "Paused."); },
            })} className={paused ? btn : "px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-amber-700 hover:bg-amber-50"}>
              {paused ? "Resume" : "Pause workspace"}
            </button>
          </Panel>
        </>
      )}
      {confirm && <ConfirmDialog cfg={confirm} onDone={() => setConfirm(null)} />}
    </Drawer>
  );
}

// ── Team ────────────────────────────────────────────────────────────────────

type StaffRow = { id: string; email: string; name: string; role: "owner" | "staff"; invitePending: boolean; lastLoginAt: string | null };

function Team({ me, owner }: { me: Me; owner: boolean }) {
  const [users, setUsers] = useState<StaffRow[] | null>(null);
  const [f, setF] = useState({ email: "", name: "", role: "staff" });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmCfg | null>(null);
  const [note, say] = useNotice();
  const load = useCallback(async () => {
    const r = await call("/api/partner/team");
    if (r.ok) setUsers((r.data.users as StaffRow[]) ?? []); else say(String(r.data.error));
  }, [say]);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    setBusy(true); say(null);
    const r = await call("/api/partner/team", "POST", f);
    setBusy(false);
    if (!r.ok) { say(String(r.data.error)); return; }
    say(`Invitation sent to ${f.email}.`, "ok"); setF({ email: "", name: "", role: "staff" }); load();
  }
  async function resend(u: StaffRow) {
    const r = await call("/api/partner/team", "POST", { resend: u.id });
    say(r.ok ? `A new link was sent to ${u.email}.` : String(r.data.error), r.ok ? "ok" : "error");
  }
  return (
    <div className="space-y-4">
      <Notice notice={note} variant="banner" onClose={() => say(null)} />
      <Panel dense>
        {!users ? <div className="flex justify-center py-10"><Spinner /></div> : (
          <Table head={<tr><Th>Person</Th><Th>Role</Th><Th>Status</Th><Th align="right">{""}</Th></tr>}>
            {users.map(u => (
              <tr key={u.id}>
                <Td><span className="font-bold text-ink-900">{u.name || u.email}</span>{u.name && <><br /><span className="text-[11px] text-ink-400">{u.email}</span></>}</Td>
                <Td>{u.role === "owner" ? "Owner" : "Staff"}</Td>
                <Td>{u.invitePending ? <Badge tone="info">Invited</Badge> : <span className="text-[12px] text-ink-600">{u.lastLoginAt ? `Last in ${ago(u.lastLoginAt)}` : "Active"}</span>}</Td>
                <Td align="right">
                  {owner && u.id !== me.user.id && (
                    <span className="flex justify-end gap-2">
                      {u.invitePending && <button onClick={() => resend(u)} className="text-[12px] font-bold text-brand-700 hover:underline">Resend</button>}
                      <button onClick={() => setConfirm({
                        title: `Remove ${u.name || u.email}?`, message: "They lose access to this dashboard straight away.", confirmLabel: "Remove",
                        onConfirm: async () => { const r = await call("/api/partner/team", "DELETE", { userId: u.id }); if (!r.ok) throw new Error(String(r.data.error)); load(); },
                      })} className="text-[12px] font-bold text-red-600 hover:underline">Remove</button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {owner ? (
        <Panel title="Invite someone">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input className={inp} placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
            <input className={`${inp} sm:col-span-2`} type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            <select className={inp} value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={invite} disabled={busy || !f.email} className={btn}>{busy ? "Sending…" : "Send invitation"}</button>
            <p className="text-[11px] text-ink-600">Owners can also invite people, change the brand and set prices.</p>
          </div>
        </Panel>
      ) : <p className="text-[12px] text-ink-600">Only an owner can invite or remove people.</p>}
      {confirm && <ConfirmDialog cfg={confirm} onDone={() => setConfirm(null)} />}
    </div>
  );
}

// ── Brand ───────────────────────────────────────────────────────────────────

const BRAND_FIELDS: { key: string; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "displayName", label: "Name customers see", placeholder: "Your business name" },
  { key: "supportEmail", label: "Support email customers see", placeholder: "help@yourbusiness.com" },
  { key: "logoUrl", label: "Logo image link (https)", placeholder: "https://…/logo.png", wide: true },
  { key: "tagline", label: "Tagline under the logo", placeholder: "Optional", wide: true },
  { key: "termsUrl", label: "Terms link (https)", placeholder: "Optional" },
  { key: "privacyUrl", label: "Privacy policy link (https)", placeholder: "Optional" },
];

function BrandTab({ me, owner, onSaved }: { me: Me; owner: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(me.partner.brand ?? {}).map(([k, v]) => [k, v ?? ""])));
  const [busy, setBusy] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [note, say] = useNotice();
  useEffect(() => { setLogoFailed(false); }, [form.logoUrl]);
  async function save() {
    setBusy(true); say(null);
    const r = await call("/api/partner/brand", "PATCH", { brand: form });
    setBusy(false);
    if (!r.ok) { say(String(r.data.error)); return; }
    say("Saved. Your customers see it within a minute.", "ok"); onSaved();
  }
  const name = form.displayName?.trim() || me.partner.name;
  return (
    <div className="space-y-4">
      <Panel title="Preview">
        {form.logoUrl && !logoFailed
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={form.logoUrl} alt={name} style={{ height: 32, width: "auto" }} onError={() => setLogoFailed(true)} />
          : <p className="text-lg font-extrabold text-ink-900">{name}</p>}
        {form.tagline && <p className="text-[11px] text-ink-400 mt-1.5">{form.tagline}</p>}
        {form.logoUrl && logoFailed && <p className="text-[12px] text-amber-700 mt-2">That logo link doesn&apos;t load an image.</p>}
      </Panel>
      <Panel title="What your customers see">
        <div className="grid grid-cols-2 gap-3">
          {BRAND_FIELDS.map(f => (
            <label key={f.key} className={f.wide ? "col-span-2" : ""}>
              <span className="block text-[11px] font-bold text-ink-600 mb-1">{f.label}</span>
              <input className={inp} disabled={!owner} placeholder={f.placeholder} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3">
          {owner ? <button onClick={save} disabled={busy} className={btn}>{busy ? "Saving…" : "Save brand"}</button> : <p className="text-[12px] text-ink-600">Only an owner can change the brand.</p>}
          <Notice notice={note} />
        </div>
      </Panel>
      <p className="text-[12px] text-ink-600">Your portal: <b>https://{me.partner.slug}.thetalko.in</b>. Your customers sign in there.</p>
    </div>
  );
}

// ── Prices (resellers) ──────────────────────────────────────────────────────

function Prices({ me, owner, onSaved }: { me: Me; owner: boolean; onSaved: () => void }) {
  const share = me.estimate.sharePct ?? me.partner.wholesalePct ?? 50;
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(me.plans.map(p => [p.key, String(Math.round((me.partner.resalePrices?.[p.key] ?? p.listCents) / 100))])));
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();
  async function save() {
    setBusy(true); say(null);
    const prices = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Math.round((Number(v.replace(/[,\s₹]/g, "")) || 0) * 100)]));
    const r = await call("/api/partner/prices", "PATCH", { prices });
    setBusy(false);
    if (!r.ok) { say(String(r.data.error)); return; }
    say("Prices saved.", "ok"); onSaved();
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600">What you charge your customers each month. It can&apos;t be lower than the list price; everything above what you pay Talko is yours.</p>
      <Panel dense>
        <Table head={<tr><Th>Plan</Th><Th align="right">List price</Th><Th align="right">You pay Talko</Th><Th align="right">You charge</Th><Th align="right">You keep</Th></tr>}>
          {me.plans.map(p => {
            const cost = Math.round(p.listCents * share / 100);
            const yours = Math.round((Number((form[p.key] ?? "").replace(/[,\s₹]/g, "")) || 0) * 100);
            const keep = yours - cost;
            return (
              <tr key={p.key}>
                <Td><span className="font-bold text-ink-900">{p.name}</span></Td>
                <Td align="right" nums>{money(p.listCents)}</Td>
                <Td align="right" nums>{money(cost)}</Td>
                <Td align="right"><input className={`${inp} w-28 text-right`} inputMode="numeric" disabled={!owner} value={form[p.key] ?? ""} onChange={e => setForm({ ...form, [p.key]: e.target.value })} /></Td>
                <Td align="right" nums className={yours < p.listCents ? "text-red-600 font-bold" : "font-bold text-emerald-700"}>{yours < p.listCents ? "Below list" : money(keep)}</Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <div className="flex items-center gap-3">
        {owner ? <button onClick={save} disabled={busy} className={btn}>{busy ? "Saving…" : "Save prices"}</button> : <p className="text-[12px] text-ink-600">Only an owner can change prices.</p>}
        <Notice notice={note} />
      </div>
      <p className="text-[12px] text-ink-600">Prices are per workspace per month, before GST. You pay Talko {share}% of list price per live workspace{share < (me.partner.wholesalePct ?? 50) ? ", your volume rate" : ""}.</p>
    </div>
  );
}
