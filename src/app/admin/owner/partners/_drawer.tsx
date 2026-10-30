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

          <BrandPanel partner={p} onSaved={async () => { await load(); onChanged(); }} />

          <Panel title="Deal">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Row k="Setup fee" v={money(p.setupFeeCents)} />
              <Row k={p.kind === "private" ? "Brand fee, monthly" : "Platform fee, monthly"} v={money(p.monthlyFeeCents)} />
              <Row k="Deposit" v={money(p.depositCents)} />
              {p.kind === "reseller" && <Row k="Wholesale" v={`${p.wholesalePct ?? 0}% of list price`} />}
              <Row k="Grace before pause" v={`${p.graceDays} days`} />
              <Row k="Plans" v={p.allowedPlans.join(", ") || "None"} />
              <Row k="Contact" v={[p.contactName, p.contactEmail, p.contactPhone].filter(Boolean).join(" · ") || "Not set"} />
            </dl>
          </Panel>

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
