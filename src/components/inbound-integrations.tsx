"use client";

// Incoming events: a business connects the tools it already runs on — its
// store, payment gateway, booking page, lead sources — and decides what each
// event should say on WhatsApp.
//
// Two halves per tool. "Connect" is the tool's side: credentials, the webhook
// URL to paste, and where in the tool it goes. "Messages" is the business's
// side: for each event (order placed, payment failed, booking made) which
// approved template goes out, filled with the event's details. Messages are
// ordinary API rules (src/lib/apirules.ts), so they run, cap, delay and report
// exactly as the rules in Broadcast → API do.
//
// The one catalog of the Integrations tab. Two directions live here, and each
// tool appears ONCE:
//   - the tool tells the portal something happened (this component's panels), and
//   - the portal acts in the tool (CRM sync, payment links, catalog import,
//     Slack/Teams/webhook alerts) — set up by the parent tab's own drawer.
// A tool that does both (Shopify, WooCommerce, Razorpay, Cal.com) is one card
// whose panel links to its account connection; tools that only do the second
// are extra cards. Before this there were two grids, and those four tools sat
// in both.

import { PageInfo } from "@/components/PageInfo";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plug, Search, Check, Copy, Loader2, Plus, Trash2, ExternalLink, Pause, Play, AlertTriangle, CircleCheck, Clock,
} from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Drawer } from "@/components/overlay";
import { templatePlaceholders, paramCount, isNamedFormat } from "@/lib/template-params";
import {
  CATALOG, CATEGORY_LABELS, type CatalogEntry, type CatalogEvent, type IntegrationCategory,
} from "@/lib/inbound/catalog";

import { inp } from "@/app/admin/_shared";

type Connection = {
  id: string; kind: string; status: "connected" | "paused"; config: Record<string, string>;
  lastEventAt: string | null; lastEventKey: string | null; lastError: string | null; lastErrorAt: string | null;
  createdAt: string; webhookUrl: string; generated: { key: string; value: string } | null; storedSecrets: string[];
  events: { id: string; eventKey: string; outcome: string; detail: string | null; phoneLast4: string | null; createdAt: string }[];
};
type Rule = {
  id: string; name: string; active: boolean; eventKey: string; templateName: string; languageCode: string;
  variables: string[]; delayValue: number; delayUnit: string;
};
type Template = { name: string; status: string; language: string; components?: { type: string; text?: string }[] };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

// The company's own logo on a white tile; its initials on its brand colour
// when it has none, or the file fails to load.
function Monogram({ e, size = 40 }: { e: { name: string; logo?: string | null; color: string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letters = e.name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  if (e.logo && !failed) {
    return (
      <div className="rounded-xl bg-white border border-line flex items-center justify-center shrink-0 overflow-hidden"
        style={{ width: size, height: size, padding: size * 0.16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={e.logo} alt={`${e.name} logo`} width={size} height={size} className="w-full h-full object-contain" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className="rounded-xl flex items-center justify-center text-white font-extrabold shrink-0"
      style={{ width: size, height: size, background: e.color, fontSize: size * 0.36 }} aria-hidden>
      {letters || "•"}
    </div>
  );
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold text-slate-500 uppercase">{label}</p>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className={`${inp} flex-1 min-w-0 text-xs ${mono ? "font-mono" : ""}`} onFocus={e => e.currentTarget.select()} />
        <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="shrink-0 px-3 py-2 rounded-lg border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1">
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>
    </div>
  );
}

/** A tool the portal acts in (set up by the parent tab), shown as a card of its own. */
export type ExtraTool = {
  kind: string; name: string; logo: string | null; color: string; blurb: string;
  group: "crm" | "payments" | "more"; connected: number;
};
/** For a tool in the catalog that ALSO has an account connection: what it adds. */
export type AccountLink = { kind: string; title: string; blurb: string; connected: number };
const EXTRA_GROUP_LABELS = { crm: "CRM & sync", more: "Alerts & other tools" } as const;

export default function InboundIntegrations({ extras = [], accountLinks = {}, onOpenAccount }: {
  extras?: ExtraTool[]; accountLinks?: Record<string, AccountLink>; onOpenAccount?: (kind: string) => void;
} = {}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<IntegrationCategory | "all" | "crm" | "more">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/inbound");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setConnections(d.connections ?? []); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKind = useMemo(() => new Map(connections.map(c => [c.kind, c])), [connections]);
  const visible = CATALOG
    .filter(e => category === "all" || e.category === category)
    .filter(e => { const q = query.trim().toLowerCase(); return !q || `${e.name} ${e.blurb} ${CATEGORY_LABELS[e.category]}`.toLowerCase().includes(q); })
    // Connected first, then what can be connected today, then what is coming.
    .sort((a, b) => Number(byKind.has(b.id)) - Number(byKind.has(a.id)) || Number(b.availability !== "next") - Number(a.availability !== "next"));
  const openEntry = open ? CATALOG.find(e => e.id === open) ?? null : null;
  const q = query.trim().toLowerCase();
  const visibleExtras = extras
    .filter(x => category === "all" || x.group === category)
    .filter(x => !q || `${x.name} ${x.blurb}`.toLowerCase().includes(q))
    .sort((a, b) => b.connected - a.connected);
  const chips: (IntegrationCategory | "all" | "crm" | "more")[] = [
    "all", ...(Object.keys(CATEGORY_LABELS) as IntegrationCategory[]),
    ...(extras.some(x => x.group === "crm") ? ["crm" as const] : []),
    ...(extras.some(x => x.group === "more") ? ["more" as const] : []),
  ];
  const chipLabel = (c: (typeof chips)[number]) => c === "all" ? "All" : c === "crm" || c === "more" ? EXTRA_GROUP_LABELS[c] : CATEGORY_LABELS[c];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em] flex items-center gap-1.5"><Plug className="w-3.5 h-3.5" /> Add an integration</p>
      </div>

      {error && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${inp} pl-9 w-60`} placeholder="Search integrations" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {chips.map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${category === c ? "bg-ink-900 text-white border-ink-900" : "bg-white text-slate-500 border-line hover:text-ink-900"}`}>
            {chipLabel(c)}
          </button>
        ))}
      </div>

      {!loaded ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map(e => {
            const conn = byKind.get(e.id);
            return (
              <button key={e.id} onClick={() => setOpen(e.id)} title={e.blurb}
                className="text-left bg-white border border-line rounded-card p-4 hover:border-brand-500 transition-colors flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <Monogram e={e} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-ink-900 leading-tight">{e.name}</p>
                    <p className="text-[11px] text-slate-400">{CATEGORY_LABELS[e.category]}</p>
                  </div>
                  {conn ? (
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${conn.status === "paused" ? "bg-slate-100 text-slate-500" : conn.lastError ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}`}>
                      {conn.status === "paused" ? "Paused" : conn.lastError ? "Check" : "Connected"}
                    </span>
                  ) : e.availability === "next" ? (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Coming next</span>
                  ) : null}
                </div>
                {conn && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Last event {ago(conn.lastEventAt)}</p>}
              </button>
            );
          })}
          {visibleExtras.map(x => (
            <button key={`extra-${x.kind}`} onClick={() => onOpenAccount?.(x.kind)} title={x.blurb}
              className="text-left bg-white border border-line rounded-card p-4 hover:border-brand-500 transition-colors flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <Monogram e={x} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-ink-900 leading-tight">{x.name}</p>
                  <p className="text-[11px] text-slate-400">{x.group === "payments" ? CATEGORY_LABELS.payments : EXTRA_GROUP_LABELS[x.group]}</p>
                </div>
                {x.connected > 0 && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">{x.connected > 1 ? `${x.connected} connected` : "Connected"}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {openEntry && (
        <IntegrationPanel entry={openEntry} connection={byKind.get(openEntry.id) ?? null}
          accountLink={accountLinks[openEntry.id]}
          onOpenAccount={onOpenAccount ? (k) => { setOpen(null); onOpenAccount(k); } : undefined}
          onClose={() => setOpen(null)} onChanged={load} />
      )}
    </div>
  );
}

// ── One tool: connect it, and say what each of its events should send ───────
function IntegrationPanel({ entry, connection, accountLink, onOpenAccount, onClose, onChanged }: {
  entry: CatalogEntry; connection: Connection | null; accountLink?: AccountLink; onOpenAccount?: (kind: string) => void;
  onClose: () => void; onChanged: () => void;
}) {
  const ask = useConfirm();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => { setValues(connection?.config ?? {}); setEditing(false); setMsg(null); }, [entry.id, connection]);

  const showForm = entry.availability !== "next" && (!connection || editing);

  async function connect() {
    setBusy(true); setMsg(null);
    try {
      const config: Record<string, string> = {}, secrets: Record<string, string> = {};
      for (const f of entry.fields ?? []) (f.secret ? secrets : config)[f.key] = values[f.key] ?? "";
      const r = await fetch("/api/admin/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: entry.id, config, secrets }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMsg({ ok: true, text: d.detail || "Connected." });
      setEditing(false);
      onChanged();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  }

  async function setPaused(paused: boolean) {
    setBusy(true);
    await fetch("/api/admin/inbound", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: entry.id, paused }) });
    setBusy(false); onChanged();
  }

  async function disconnect() {
    const ok = await ask({
      title: `Disconnect ${entry.name}?`, tone: "danger", confirmLabel: "Disconnect",
      message: `The portal stops receiving ${entry.name} events, so the messages set up below stop going out. Contacts already brought in stay. To reconnect later you will set it up in ${entry.name} again.`,
      facts: [{ label: "Integration", value: entry.name }, ...(connection ? [{ label: "Last event", value: ago(connection.lastEventAt) }] : [])],
    });
    if (!ok) return;
    setBusy(true);
    await fetch(`/api/admin/inbound?kind=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    setBusy(false); onChanged();
  }

  return (
    <Drawer open onClose={onClose} width="lg"
      title={<span className="flex items-center gap-3"><Monogram e={entry} size={36} />{entry.name}</span>}
      subtitle={entry.blurb}>
        <div className="space-y-5">

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">What you get</p>
            {entry.gives.map(g => <p key={g} className="text-xs text-ink-700 flex items-start gap-2"><CircleCheck className="w-3.5 h-3.5 text-brand-600 shrink-0 mt-0.5" />{g}</p>)}
          </div>

          {/* The same tool, from the other side: the portal acting in it. One card, both jobs. */}
          {accountLink && onOpenAccount && (
            <div className="rounded-card border border-line bg-slate-50 p-4 space-y-2">
              <p className="text-sm font-extrabold text-ink-900">Also connect your {entry.name} account</p>
              <p className="text-xs text-slate-600">{accountLink.blurb}</p>
              <button onClick={() => onOpenAccount(accountLink.kind)} className="px-3 py-1.5 rounded-lg border border-line bg-white text-xs font-bold text-ink-800 hover:bg-canvas">
                {accountLink.connected ? `Manage: ${accountLink.title}` : accountLink.title}
              </button>
            </div>
          )}

          {entry.availability === "next" && (
            <p className="text-xs text-slate-600 bg-slate-50 border border-line rounded-control px-3 py-2.5"><b>Coming next.</b> {entry.pending}</p>
          )}

          {/* Status of a live connection */}
          {connection && (
            <div className={`rounded-control border px-3 py-2.5 text-xs space-y-1 ${connection.lastError ? "bg-amber-50 border-amber-200" : "bg-brand-50 border-brand-100"}`}>
              <p className="font-bold text-ink-900 flex items-center gap-1.5">
                {connection.status === "paused" ? <><Pause className="w-3.5 h-3.5" /> Paused — events are received but nothing is sent</>
                  : connection.lastError ? <><AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Connected, with a problem</>
                  : <><CircleCheck className="w-3.5 h-3.5 text-brand-600" /> Connected</>}
              </p>
              <p className="text-slate-600">Last event: {ago(connection.lastEventAt)}{connection.lastEventKey ? ` (${connection.lastEventKey})` : ""}</p>
              {connection.lastError && <p className="text-amber-800">{connection.lastError} <span className="text-amber-600">· {ago(connection.lastErrorAt)}</span></p>}
            </div>
          )}
          {/* Setup: the URL and secret to paste into the tool */}
          {connection && (entry.showsWebhookUrl !== false || connection.generated) && (
            <div className="space-y-3 border border-line rounded-card p-4">
              <p className="text-sm font-extrabold text-ink-900">Set it up in {entry.name}</p>
              {entry.showsWebhookUrl !== false && <CopyField label="Webhook URL" value={connection.webhookUrl} />}
              {connection.generated?.value && <CopyField label={entry.generated?.label ?? "Secret"} value={connection.generated.value} />}
              {entry.steps && (
                <ol className="list-decimal pl-4 space-y-1 text-xs text-ink-700">{entry.steps.map(s => <li key={s}>{s}</li>)}</ol>
              )}
              {entry.docsUrl && <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-700 inline-flex items-center gap-1 hover:underline">{entry.name}&apos;s guide <ExternalLink className="w-3 h-3" /></a>}
            </div>
          )}

          {/* Connect / edit form */}
          {showForm && (
            <div className="space-y-3 border border-line rounded-card p-4">
              <p className="text-sm font-extrabold text-ink-900">{connection ? "Settings" : `Connect ${entry.name}`}</p>
              {!connection && entry.steps && (
                <p className="text-[11px] text-slate-500">After you connect, the portal shows the webhook URL{entry.generated ? " and secret" : ""} to paste into {entry.name}, with the steps.</p>
              )}
              {(entry.fields ?? []).map(f => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-[11px] font-bold text-slate-600">{f.label}{f.required ? " *" : ""}</span>
                  <input className={`${inp} w-full`} type={f.secret ? "password" : "text"} autoComplete="off"
                    placeholder={f.secret && connection?.storedSecrets.includes(f.key) ? "Saved — leave blank to keep" : f.placeholder}
                    value={values[f.key] ?? ""} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
                  {f.hint && <span className="block text-[11px] text-slate-400">{f.hint}</span>}
                </label>
              ))}
              <div className="flex items-center gap-2">
                <button onClick={connect} disabled={busy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} {connection ? "Save" : "Connect"}
                </button>
                {editing && <button onClick={() => setEditing(false)} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>}
              </div>
            </div>
          )}
          {msg && <p className={`text-xs font-semibold rounded-control px-3 py-2 border ${msg.ok ? "text-brand-700 bg-brand-50 border-brand-200" : "text-amber-800 bg-amber-50 border-amber-200"}`}>{msg.text}</p>}

          {connection && !editing && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-ink-600 hover:bg-canvas">Edit settings</button>
              {connection && (connection.status === "paused"
                ? <button onClick={() => setPaused(false)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1"><Play className="w-3.5 h-3.5" /> Resume</button>
                : <button onClick={() => setPaused(true)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1"><Pause className="w-3.5 h-3.5" /> Pause</button>)}
              {connection && <button onClick={disconnect} disabled={busy} className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Disconnect</button>}
            </div>
          )}

          {connection && entry.events?.length ? <EventMessages entry={entry} /> : null}

          {connection && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">Recent events</p>
              {connection.events.length === 0
                ? <p className="text-xs text-slate-400">Nothing received yet. Once {entry.name} sends its first event it shows here, with what the portal did.</p>
                : connection.events.map(ev => (
                  <div key={ev.id} className="text-xs border-b border-line last:border-0 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${ev.outcome === "processed" ? "bg-brand-50 text-brand-700" : ev.outcome === "failed" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>{ev.outcome}</span>
                      <span className="font-mono text-ink-700">{entry.events?.find(x => x.key === ev.eventKey)?.label ?? ev.eventKey}</span>
                      {ev.phoneLast4 && <span className="text-slate-400">· …{ev.phoneLast4}</span>}
                      <span className="ml-auto text-slate-400">{ago(ev.createdAt)}</span>
                    </div>
                    {ev.detail && <p className="text-slate-500 mt-0.5">{ev.detail}</p>}
                  </div>
                ))}
            </div>
          )}
        </div>
    </Drawer>
  );
}

// ── What each event sends: API rules for this tool's event keys ────────────
function EventMessages({ entry }: { entry: CatalogEntry }) {
  const ask = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/api-rules").then(r => r.json()).then(d => setRules((d.rules ?? []).filter((r: Rule) => r.eventKey.startsWith(`${entry.id}.`)))).catch(() => {});
  }, [entry.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/templates").then(r => r.json()).then(d => setTemplates((d.templates ?? []).filter((t: Template) => t.status === "APPROVED"))).catch(() => {});
  }, []);

  async function toggle(r: Rule) {
    await fetch("/api/admin/api-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, active: !r.active }) });
    load();
  }
  async function remove(r: Rule) {
    if (!(await ask({ title: "Delete this message?", tone: "danger", confirmLabel: "Delete", facts: [{ label: "Message", value: r.name }, { label: "Template", value: r.templateName }] }))) return;
    await fetch("/api/admin/api-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) });
    load();
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="group flex items-center gap-1.5"><p className="text-sm font-extrabold text-ink-900">Messages</p><PageInfo>Choose what goes out on WhatsApp when each event happens. Use an approved template; for order, payment and booking updates a Utility template is the right category.</PageInfo></div>
      </div>
      {(entry.events ?? []).map(ev => {
        const mine = rules.filter(r => r.eventKey === ev.key);
        return (
          <div key={ev.key} className="border border-line rounded-card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-ink-900">{ev.label}</p>
                <p className="text-[11px] text-slate-400">Idea: {ev.suggestion}</p>
              </div>
              {adding !== ev.key && (
                <button onClick={() => setAdding(ev.key)} className="shrink-0 px-2.5 py-1 rounded-lg border border-brand-dark text-brand-dark text-[11px] font-bold flex items-center gap-1 hover:bg-brand-50"><Plus className="w-3 h-3" /> Add message</button>
              )}
            </div>
            {mine.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs bg-canvas rounded-lg px-2.5 py-1.5">
                <span className={`w-2 h-2 rounded-full ${r.active ? "bg-brand-500" : "bg-slate-300"}`} />
                <span className="font-mono text-ink-700 truncate">{r.templateName}</span>
                <span className="text-slate-400 shrink-0">{r.delayValue ? `after ${r.delayValue} ${r.delayUnit}` : "right away"}</span>
                <span className="flex-1" />
                <button onClick={() => toggle(r)} className="text-[11px] font-bold text-slate-500 hover:text-ink-900">{r.active ? "Pause" : "Turn on"}</button>
                <button onClick={() => remove(r)} aria-label="Delete message" className="p-1 text-slate-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            {adding === ev.key && <MessageForm event={ev} entry={entry} templates={templates} onDone={() => { setAdding(null); load(); }} />}
          </div>
        );
      })}
    </div>
  );
}

function MessageForm({ event, entry, templates, onDone }: { event: CatalogEvent; entry: CatalogEntry; templates: Template[]; onDone: () => void }) {
  const [tpl, setTpl] = useState("");
  const [vars, setVars] = useState<string[]>([]);
  const [focus, setFocus] = useState(0);
  const [delay, setDelay] = useState(0);
  const [unit, setUnit] = useState("minutes");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chosen = templates.find(t => `${t.name}|${t.language}` === tpl);
  const body = chosen?.components?.find(c => c.type === "BODY")?.text ?? "";
  const tokens = templatePlaceholders(body);
  const count = paramCount(tokens);
  useEffect(() => { setVars(v => Array.from({ length: count }, (_, i) => v[i] ?? "")); setFocus(0); }, [tpl, count]);

  const insert = (token: string) => setVars(v => v.map((x, i) => (i === focus ? `${x}{{${token}}}` : x)));

  async function save() {
    if (!chosen) { setErr("Choose a template."); return; }
    if (vars.some(v => !v.trim())) { setErr("Fill every variable — click a detail below to insert it."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/api-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${entry.name}: ${event.label}`, eventKey: event.key, active: true,
        templateName: chosen.name, languageCode: chosen.language, variables: vars,
        delayValue: delay, delayUnit: unit, conditions: [],
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error || `HTTP ${r.status}`); return; }
    onDone();
  }

  return (
    <div className="space-y-2.5 border-t border-line pt-2.5">
      <select className={`${inp} w-full text-xs`} value={tpl} onChange={e => setTpl(e.target.value)}>
        <option value="">Choose an approved template…</option>
        {templates.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}
      </select>
      {body && <p className="text-[11px] text-slate-500 bg-canvas rounded-lg px-2.5 py-2 whitespace-pre-wrap">{body}</p>}
      {vars.map((v, i) => (
        <label key={i} className="block space-y-0.5">
          <span className="text-[11px] font-bold text-slate-600 font-mono">{isNamedFormat(tokens) ? `{{${tokens[i]}}}` : `{{${i + 1}}}`}</span>
          <input className={`${inp} w-full text-xs ${focus === i ? "ring-2 ring-brand-200" : ""}`} value={v} onFocus={() => setFocus(i)}
            onChange={e => setVars(vs => vs.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Type text, or click a detail below" />
        </label>
      ))}
      {count > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.fields.map(f => (
            <button key={f.token} onClick={() => insert(f.token)} title={`e.g. ${f.sample}`}
              className="px-2 py-0.5 rounded-full border border-line text-[11px] text-ink-600 hover:border-brand-500 hover:text-brand-700">+ {f.label}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Send</span>
        <input type="number" min={0} className={`${inp} w-20 text-xs`} value={delay} onChange={e => setDelay(Math.max(0, Number(e.target.value) || 0))} />
        <select className={`${inp} text-xs`} value={unit} onChange={e => setUnit(e.target.value)}>
          <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
        </select>
        <span className="text-slate-500">after it happens{delay === 0 ? " (right away)" : ""}</span>
      </div>
      {err && <p className="text-[11px] font-semibold text-amber-700">{err}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save message</button>
        <button onClick={onDone} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}
