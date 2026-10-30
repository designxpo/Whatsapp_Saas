"use client";

// Partners — the businesses running Talko under their own brand: Private Label
// companies using it for themselves, and resellers selling it to their clients.
//
// White-label Phase 1: the owner creates partners, sets their prices (filled in
// from the business plan), and links workspaces to them. Nothing a partner's
// customers see changes yet; branding arrives in Phase 2.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Building2, Plus } from "lucide-react";
import { Panel, Table, Th, Td, Spinner, EmptyState, MetricTile, Badge, Drawer, money, compact } from "../_ui";
import { PartnerDrawer } from "./_drawer";
import { KIND_LABEL, STATUS_TONE, type PartnerKind, type PartnerRow, type PartnerTier } from "./_shared";

type Pricing = { setupFeeCents: number; monthlyFeeCents: number; depositCents: number; wholesalePct: number | null; allowedPlans: string[] };
type Defaults = Record<PartnerKind, Record<PartnerTier, Pricing>>;


const inp = "w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900";

export default function PartnersPage() {
  const [partners, setPartners] = useState<PartnerRow[] | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/partners");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); setPartners(null); }
      else { setErr(null); setPartners(j.partners ?? []); setDefaults(j.defaults ?? null); setSetupNeeded(j.setupNeeded ?? null); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const live = (partners ?? []).filter(p => p.status === "active");
  const workspaces = (partners ?? []).reduce((n, p) => n + (p.workspaceCount ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Partners</h1>
          <p className="text-sm text-ink-600">Companies running Talko under their own brand, for themselves or their clients.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={() => setCreating(true)} disabled={!!setupNeeded || !defaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">
            <Plus className="w-3.5 h-3.5" /> New partner
          </button>
        </div>
      </header>

      {setupNeeded && (
        <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{setupNeeded}</span>
        </div>
      )}
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}
      {loading && !partners && <div className="flex justify-center py-16"><Spinner /></div>}

      {partners && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricTile label="Partners" value={compact(partners.length)} sub={`${compact(live.length)} active`} />
            <MetricTile label="Private Label" value={compact(partners.filter(p => p.kind === "private").length)} />
            <MetricTile label="Partner workspaces" value={compact(workspaces)} />
            <MetricTile label="Monthly fees (active)" value={money(live.reduce((s, p) => s + p.monthlyFeeCents, 0))} sub="Before per-workspace charges" />
          </div>

          <Panel dense>
            {!partners.length
              ? <EmptyState icon={<Building2 className="w-5 h-5" />} title="No partners yet"
                  body="Create a Private Label company or a reseller, then link its workspaces." />
              : (
                <Table head={
                  <tr><Th>Partner</Th><Th>Kind</Th><Th>Status</Th><Th align="right">Workspaces</Th><Th align="right">Monthly fee</Th><Th align="right">Setup fee</Th></tr>
                }>
                  {partners.map(p => (
                    <tr key={p.id} className="hover:bg-canvas cursor-pointer" onClick={() => setOpenId(p.id)}>
                      <Td><span className="font-bold text-ink-900">{p.name}</span><br /><span className="text-ink-400 text-[11px]">{p.slug}.thetalko.in</span></Td>
                      <Td>{KIND_LABEL[p.kind]} <span className="text-ink-400 capitalize">· {p.tier}</span></Td>
                      <Td><Badge tone={STATUS_TONE[p.status]}><span className="capitalize">{p.status}</span></Badge></Td>
                      <Td align="right" nums>{compact(p.workspaceCount ?? 0)}</Td>
                      <Td align="right" nums>{money(p.monthlyFeeCents)}</Td>
                      <Td align="right" nums>{money(p.setupFeeCents)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
          </Panel>
        </>
      )}

      {creating && defaults && <NewPartnerDrawer defaults={defaults} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); load(); setOpenId(id); }} />}
      {openId && <PartnerDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

const rupees = (cents: number) => String(Math.round(cents / 100));
const toCents = (s: string) => Math.round((Number(s.replace(/[,\s₹]/g, "")) || 0) * 100);

function NewPartnerDrawer({ defaults, onClose, onCreated }: { defaults: Defaults; onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<PartnerKind>("private");
  const [tier, setTier] = useState<PartnerTier>("standard");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [fees, setFees] = useState({ setup: "", monthly: "", deposit: "", pct: "" });
  const [plans, setPlans] = useState<string[]>([]);
  const [allPlans, setAllPlans] = useState<{ key: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new kind or tier resets the prices to the business plan's.
  useEffect(() => {
    const d = defaults[kind][tier];
    setFees({ setup: rupees(d.setupFeeCents), monthly: rupees(d.monthlyFeeCents), deposit: rupees(d.depositCents), pct: d.wholesalePct == null ? "" : String(d.wholesalePct) });
    setPlans(d.allowedPlans);
  }, [defaults, kind, tier]);
  useEffect(() => {
    fetch("/api/owner/plans").then(r => r.json())
      .then(j => setAllPlans((j.plans ?? []).filter((p: { key: string }) => p.key !== "trial").map((p: { key: string; name: string }) => ({ key: p.key, name: p.name }))))
      .catch(() => {});
  }, []);

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/owner/partners", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug: slug || undefined, kind, tier, contactName, contactEmail, contactPhone, allowedPlans: plans,
          setupFeeCents: toCents(fees.setup), monthlyFeeCents: toCents(fees.monthly), depositCents: toCents(fees.deposit),
          wholesalePct: kind === "reseller" ? Number(fees.pct) : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setError(j.error || `Couldn't create (HTTP ${r.status})`);
      else onCreated(j.partner.id);
    } catch { setError("Couldn't reach the server."); }
    finally { setBusy(false); }
  }

  const label = "block text-[11px] font-bold text-ink-600 mb-1";
  return (
    <Drawer open onClose={onClose} title="New partner" subtitle="Prices start from the White-Label Business Plan; change them for this deal if you agreed different ones."
      actions={<button onClick={create} disabled={busy || name.trim().length < 2} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Creating…" : "Create partner"}</button>}>
      <Panel>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["private", "reseller"] as PartnerKind[]).map(k => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`text-left rounded-control border p-3 ${kind === k ? "border-brand-500 bg-brand-50" : "border-line bg-white hover:border-slate-300"}`}>
                <p className="text-sm font-bold text-ink-900">{KIND_LABEL[k]}</p>
                <p className="text-[11px] text-ink-600">{k === "private" ? "One company using Talko for its own business" : "Sells Talko to its own clients"}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["standard", "pro"] as PartnerTier[]).map(t => (
              <button key={t} type="button" onClick={() => setTier(t)}
                className={`px-3 py-1.5 rounded-full border text-xs font-bold capitalize ${tier === t ? "bg-ink-900 text-white border-ink-900" : "bg-white text-ink-600 border-line"}`}>{t}</button>
            ))}
          </div>
          <div>
            <label className={label}>Company name</label>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Bright Dental Group" />
          </div>
          <div>
            <label className={label}>Address on Talko</label>
            <div className="flex items-center gap-1.5">
              <input className={inp} value={slug} onChange={e => setSlug(e.target.value)} placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "brightdental"} />
              <span className="text-sm text-ink-600 shrink-0">.thetalko.in</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={label}>Contact name</label><input className={inp} value={contactName} onChange={e => setContactName(e.target.value)} /></div>
            <div><label className={label}>Email</label><input className={inp} value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
            <div><label className={label}>Phone</label><input className={inp} value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
          </div>
        </div>
      </Panel>
      <Panel title="Prices for this deal (₹, before GST)">
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Setup fee, one time</label><input className={inp} inputMode="numeric" value={fees.setup} onChange={e => setFees({ ...fees, setup: e.target.value })} /></div>
          <div><label className={label}>{kind === "private" ? "Brand fee, monthly" : "Platform fee, monthly"}</label><input className={inp} inputMode="numeric" value={fees.monthly} onChange={e => setFees({ ...fees, monthly: e.target.value })} /></div>
          <div><label className={label}>Security deposit</label><input className={inp} inputMode="numeric" value={fees.deposit} onChange={e => setFees({ ...fees, deposit: e.target.value })} /></div>
          {kind === "reseller" && <div><label className={label}>Wholesale, % of list price</label><input className={inp} inputMode="decimal" value={fees.pct} onChange={e => setFees({ ...fees, pct: e.target.value })} /></div>}
        </div>
      </Panel>
      <Panel title={kind === "private" ? "Plans they may use" : "Plans they may sell"}>
        <div className="flex flex-wrap gap-2">
          {allPlans.map(p => {
            const on = plans.includes(p.key);
            return (
              <button key={p.key} type="button" onClick={() => setPlans(on ? plans.filter(x => x !== p.key) : [...plans, p.key])}
                className={`px-3 py-1.5 rounded-full border text-xs font-bold ${on ? "bg-brand-50 text-brand-700 border-brand-100" : "bg-white text-ink-600 border-line"}`}>{p.name}</button>
            );
          })}
        </div>
      </Panel>
      {error && <p className="text-xs text-red-600 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />{error}</p>}
    </Drawer>
  );
}
