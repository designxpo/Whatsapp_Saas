"use client";

// Tenants — the fleet inventory.
//
// Everything here is server-driven: search, filters, sort and paging all happen
// in Postgres against the indexes 0106 added. The old portal fetched every tenant
// and filtered the array in the browser, which stops working long before 100k —
// and, past PostgREST's max_rows, started quietly lying about the total.
//
// Rows open a drawer rather than navigating, so an operator working a queue keeps
// their place in it.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Users, Filter, X, Loader2, AlertTriangle } from "lucide-react";
import { QUEUES, QUEUE_BY_KEY } from "@/lib/ownerqueues";
import {
  Panel, Table, Th, Td, Badge, EmptyState, Spinner, SearchInput, ConfirmDialog,
  money, compact, ago, until, useDebounced, useLatest,
  STATUS_TONE, PAYMENT_TONE, type ConfirmCfg,
} from "../_ui";
import { TenantDrawer } from "./_drawer";

export type Row = {
  id: string; name: string; slug: string; status: string; plan: string;
  company: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
  paymentStatus: string; trialEndsAt: string | null; currentPeriodEnd: string | null;
  amountCents: number; currency: string; grandfathered: boolean; notes: string | null; createdAt: string;
  metrics: null | {
    contacts: number; conversations: number; messages: number; channels: number;
    lastInboundAt: string | null; waQuality: string | null; waHealth: string | null;
    marketingPaused: boolean; aiConfigured: boolean; integrationsErrored: number;
    health: string; usagePctMax: number; refreshedAt: string | null;
  };
};

const STATUSES = ["active", "trialing", "suspended", "cancelled"];
const PAYMENTS = ["trialing", "active", "past_due", "cancelled", "none"];
const SORTS = [
  { key: "newest", label: "Newest" }, { key: "oldest", label: "Oldest" },
  { key: "name", label: "Name" }, { key: "mrr", label: "MRR" }, { key: "trial", label: "Trial ending" },
];
const sel = "border border-line rounded-control px-2 py-2 text-xs bg-white text-ink-900";

export default function TenantsPage() {
  return <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}><TenantsInner /></Suspense>;
}

function TenantsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const queue = params.get("queue");
  const openId = params.get("open");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [payment, setPayment] = useState("");
  const [sort, setSort] = useState("newest");
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmCfg, setConfirmCfg] = useState<ConfirmCfg | null>(null);
  const [plans, setPlans] = useState<string[]>([]);

  const debouncedQ = useDebounced(q, 300);
  const latest = useLatest();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ.trim()) p.set("q", debouncedQ.trim());
    if (queue) p.set("queue", queue);
    if (status) p.set("status", status);
    if (plan) p.set("plan", plan);
    if (payment) p.set("payment", payment);
    if (sort !== "newest") p.set("sort", sort);
    return p;
  }, [debouncedQ, queue, status, plan, payment, sort]);

  const load = useCallback(async (nextCursor?: string) => {
    const seq = latest.next();
    nextCursor ? setMore(true) : setLoading(true);
    try {
      const p = new URLSearchParams(qs);
      if (nextCursor) p.set("cursor", nextCursor);
      const r = await fetch(`/api/owner/tenants?${p}`);
      const d = await r.json();
      if (!latest.isCurrent(seq)) return;
      if (!r.ok || d.error) { setErr(d.error || `Couldn't load (HTTP ${r.status})`); return; }
      setErr(null);
      setRows(prev => nextCursor ? [...prev, ...(d.tenants ?? [])] : (d.tenants ?? []));
      setCursor(d.nextCursor ?? null);
      setHasMore(!!d.hasMore);
    } catch {
      if (latest.isCurrent(seq)) setErr("Couldn't reach the server.");
    } finally {
      if (latest.isCurrent(seq)) { setLoading(false); setMore(false); }
    }
  }, [qs, latest]);

  useEffect(() => { setPicked(new Set()); load(); }, [load]);
  useEffect(() => { fetch("/api/owner/plans").then(r => r.json()).then(d => setPlans((d.plans ?? []).map((p: { key: string }) => p.key))).catch(() => {}); }, []);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    v ? p.set(k, v) : p.delete(k);
    router.replace(`/admin/owner/tenants${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };

  const qdef = queue ? QUEUE_BY_KEY[queue] : null;
  const filtered = !!(queue || status || plan || payment || debouncedQ.trim());
  const allPicked = rows.length > 0 && picked.size === rows.length;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-brand-dark">{qdef ? qdef.title : "Tenants"}</h1>
          <p className="text-sm text-ink-600">{qdef ? qdef.why : "Every account on the platform."}</p>
        </div>
        {qdef && (
          <button onClick={() => setParam("queue", null)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas">
            <X className="w-3.5 h-3.5" /> Clear queue
          </button>
        )}
      </header>

      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <SearchInput value={q} onChange={setQ} placeholder="Company, email, phone, or slug…" />
          <select value={queue ?? ""} onChange={e => setParam("queue", e.target.value || null)} className={sel}>
            <option value="">Any queue</option>
            {QUEUES.map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={sel}>
            <option value="">Any status</option>
            {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
          <select value={payment} onChange={e => setPayment(e.target.value)} className={sel}>
            <option value="">Any payment</option>
            {PAYMENTS.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <select value={plan} onChange={e => setPlan(e.target.value)} className={sel}>
            <option value="">Any plan</option>
            {plans.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} className={sel} title="Sort">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {filtered && (
            <button onClick={() => { setQ(""); setStatus(""); setPlan(""); setPayment(""); setSort("newest"); setParam("queue", null); }}
              className="px-2.5 py-2 rounded-control text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Reset
            </button>
          )}
        </div>

        {picked.size > 0 && (
          <BulkBar count={picked.size} plans={plans} ids={[...picked]}
            onDone={() => { setPicked(new Set()); load(); }} setConfirm={setConfirmCfg} />
        )}

        {err && (
          <div className="m-3 bg-red-50 border border-red-200 rounded-control px-3 py-2.5 text-[13px] text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
          </div>
        )}

        {loading && <div className="flex justify-center py-16"><Spinner /></div>}

        {!loading && !rows.length && !err && (
          <EmptyState icon={<Users className="w-5 h-5" />}
            title={qdef ? `Nothing in ${qdef.title.toLowerCase()}` : filtered ? "No tenant matches those filters" : "No tenants yet"}
            body={qdef ? "This queue is clear." : filtered ? "Try widening the search or clearing a filter." : undefined} />
        )}

        {!loading && rows.length > 0 && (
          <Table head={
            <tr>
              <Th w="36px"><input type="checkbox" checked={allPicked} onChange={e => setPicked(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} className="accent-brand-700" aria-label="Select all" /></Th>
              <Th>Tenant</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th align="right">MRR</Th>
              <Th>Health</Th>
              <Th align="right">Contacts</Th>
              <Th>Last inbound</Th>
              <Th>Joined</Th>
            </tr>
          }>
            {rows.map(t => {
              const m = t.metrics;
              const bad = m?.waQuality === "RED" || m?.waHealth === "FLAGGED" || m?.waHealth === "RESTRICTED";
              return (
                <tr key={t.id} className="hover:bg-canvas cursor-pointer" onClick={() => setParam("open", t.id)}>
                  <Td><input type="checkbox" checked={picked.has(t.id)} onClick={e => e.stopPropagation()}
                    onChange={e => setPicked(s => { const n = new Set(s); e.target.checked ? n.add(t.id) : n.delete(t.id); return n; })}
                    className="accent-brand-700" aria-label={`Select ${t.company || t.name}`} /></Td>
                  <Td>
                    <p className="font-bold text-ink-900 truncate max-w-[220px]">{t.company || t.name}</p>
                    <p className="text-[11px] text-ink-600 font-mono truncate max-w-[220px]">{t.ownerEmail ?? "—"}</p>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] font-semibold text-ink-900">{t.plan}</span>
                      {t.grandfathered && <Badge tone="info" title="All features on regardless of plan">GF</Badge>}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5 items-start">
                      <Badge tone={STATUS_TONE[t.status] ?? "muted"}>{t.status}</Badge>
                      {t.paymentStatus !== t.status && <Badge tone={PAYMENT_TONE[t.paymentStatus] ?? "muted"}>{t.paymentStatus.replace("_", " ")}</Badge>}
                    </div>
                  </Td>
                  <Td align="right" nums>{t.amountCents ? money(t.amountCents, t.currency) : "—"}</Td>
                  <Td>
                    {!m ? <span className="text-[11px] text-ink-400">—</span> : (
                      <div className="flex flex-wrap gap-1">
                        {bad && <Badge tone="bad">WA {m.waQuality === "RED" ? "RED" : m.waHealth}</Badge>}
                        {m.marketingPaused && <Badge tone="bad">paused</Badge>}
                        {m.integrationsErrored > 0 && <Badge tone="warn">{m.integrationsErrored} integ</Badge>}
                        {m.channels === 0 && <Badge tone="warn">no channel</Badge>}
                        {!bad && !m.marketingPaused && !m.integrationsErrored && m.channels > 0 && <Badge tone="ok">ok</Badge>}
                      </div>
                    )}
                  </Td>
                  <Td align="right" nums>{m ? compact(m.contacts) : "—"}</Td>
                  <Td><span className="text-[12px] text-ink-600">{m?.lastInboundAt ? ago(m.lastInboundAt) : "—"}</span></Td>
                  <Td>
                    <span className="text-[12px] text-ink-600">{ago(t.createdAt)}</span>
                    {t.trialEndsAt && t.paymentStatus === "trialing" && (
                      <p className="text-[10px] text-amber-600">trial {until(t.trialEndsAt)}</p>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}

        {hasMore && (
          <div className="p-3 border-t border-line flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-400 tabular-nums">Showing {rows.length.toLocaleString()}</span>
            <button onClick={() => cursor && load(cursor)} disabled={more || !cursor}
              className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60 flex items-center gap-1.5">
              {more && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Load more
            </button>
          </div>
        )}
        {!hasMore && rows.length > 0 && (
          <div className="p-3 border-t border-line">
            <span className="text-[11px] text-ink-400 tabular-nums">{rows.length.toLocaleString()} {rows.length === 1 ? "tenant" : "tenants"}{cursor === null && !hasMore ? " — end of list" : ""}</span>
          </div>
        )}
      </Panel>

      {openId && <TenantDrawer id={openId} onClose={() => setParam("open", null)} onChanged={() => load()} setConfirm={setConfirmCfg} />}
      {confirmCfg && <ConfirmDialog cfg={confirmCfg} onDone={() => setConfirmCfg(null)} />}
    </div>
  );
}

// ── Bulk actions ──────────────────────────────────────────────────────────────
// Always a dry run first: the server answers "how many, and which ones" before
// anything is written, because at this scale a mistaken bulk write is the most
// expensive thing an operator can do.

function BulkBar({ count, ids, plans, onDone, setConfirm }: {
  count: number; ids: string[]; plans: string[]; onDone: () => void; setConfirm: (c: ConfirmCfg) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(patch: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      const preview = await fetch("/api/owner/tenants/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, patch, dryRun: true }),
      }).then(r => r.json());
      if (preview.error) throw new Error(preview.error);

      setConfirm({
        title: `${label} — ${preview.affected} tenant${preview.affected === 1 ? "" : "s"}`,
        confirmLabel: `Apply to ${preview.affected}`,
        message: (
          <div className="space-y-2">
            <p>This will {label.toLowerCase()} for {preview.affected} account{preview.affected === 1 ? "" : "s"}
              {preview.missing > 0 && <> ({preview.missing} selected {preview.missing === 1 ? "row was" : "rows were"} not found)</>}.</p>
            <ul className="text-[12px] text-ink-600 bg-canvas rounded-control px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
              {(preview.sample ?? []).map((s: { id: string; name: string }) => <li key={s.id} className="truncate">{s.name}</li>)}
              {preview.affected > (preview.sample?.length ?? 0) && <li className="text-ink-400">…and {preview.affected - preview.sample.length} more</li>}
            </ul>
          </div>
        ),
        onConfirm: async () => {
          const res = await fetch("/api/owner/tenants/bulk", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, patch, dryRun: false }),
          }).then(r => r.json());
          if (res.error) throw new Error(res.error);
          if (res.failed?.length) throw new Error(`${res.applied} applied, ${res.failed.length} failed — ${res.failed[0].name}: ${res.failed[0].error}`);
          onDone();
        },
      });
    } catch (e) {
      setConfirm({ title: "Couldn't preview that", message: e instanceof Error ? e.message : "Unknown error", confirmLabel: "Close", onConfirm: () => {} });
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-brand-50 border-b border-brand-100">
      <span className="text-[12px] font-bold text-brand-900">{count} selected</span>
      <span className="text-[11px] text-ink-600">Preview first — nothing is written until you confirm.</span>
      <div className="flex-1" />
      <select disabled={busy} defaultValue="" onChange={e => { if (e.target.value) { run({ plan: e.target.value }, `Move to ${e.target.value}`); e.target.value = ""; } }} className={sel}>
        <option value="">Change plan…</option>
        {plans.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <button disabled={busy} onClick={() => run({ status: "suspended" }, "Suspend")}
        className="px-2.5 py-1.5 rounded-control border border-red-200 bg-white text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60">Suspend</button>
      <button disabled={busy} onClick={() => run({ status: "active" }, "Reactivate")}
        className="px-2.5 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Reactivate</button>
      <button disabled={busy} onClick={() => run({ grandfathered: true }, "Grandfather")}
        className="px-2.5 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Grandfather</button>
      {busy && <Loader2 className="w-4 h-4 animate-spin text-brand-700" />}
    </div>
  );
}
