"use client";

// Health — fleet failure classes, not a list of tenants.
//
// The old version rendered one row per tenant, sorted worst-first. That was the
// right instinct at 5 tenants and useless at 100k: nobody scrolls a hundred
// thousand rows, and building it cost ~8 queries per tenant inside a 60-second
// budget. What an operator needs is "how many are broken, in which way" and a way
// into each group — the per-tenant detail is one click away in the tenant list.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { MetricTile, Panel, Spinner, Badge, ago, compact } from "../_ui";
import { MetaDoctor } from "../../_tabs/MetaDoctor";

type Payload = {
  fleet: { total: number; ok: number; warn: number; error: number };
  classes: { key: string; label: string; count: number; severity: string }[];
  freshness: { oldest: string | null; newest: string | null; rows: number } | null;
  platform: { cronLastTick: string | null; cronAgeMin: number | null; cronOk: boolean; crmSync: { pending: number; dead: number } };
  error?: string;
};

export default function HealthPage() {
  const router = useRouter();
  const [d, setD] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/health");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); setD(null); }
      else { setErr(null); setD(j); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const broken = d ? d.classes.reduce((s, c) => s + c.count, 0) : 0;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Health</h1>
          <p className="text-sm text-ink-600">Platform subsystems first, then what&apos;s broken across the fleet.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
        </div>
      )}
      {loading && !d && <div className="flex justify-center py-16"><Spinner /></div>}

      {d && (
        <>
          {/* Subsystem failures affect every tenant at once, so they outrank
              anything per-tenant below them. */}
          <Panel title="Platform subsystems">
            <div className="grid sm:grid-cols-3 gap-3">
              <Subsystem name="Background engine" ok={d.platform.cronOk}
                detail={d.platform.cronAgeMin === null ? "has never run" : `last tick ${d.platform.cronAgeMin}m ago`}
                fix="Everything queue-driven — broadcasts, AI follow-ups, sequences — is stopped. Check the GitHub Actions cron and the CRON_URL variable." />
              <Subsystem name="CRM sync" ok={d.platform.crmSync.dead === 0}
                detail={`${compact(d.platform.crmSync.pending)} pending · ${compact(d.platform.crmSync.dead)} dead`}
                fix="Dead rows exhausted their retries — the lead never reached the CRM." />
              <Subsystem name="Fleet sweep" ok={!!d.freshness?.rows}
                detail={d.freshness?.rows ? `${compact(d.freshness.rows)} rows · oldest ${ago(d.freshness.oldest)}` : "has not run"}
                fix="Apply migration 0106 and let the tenant-metrics cron run once. Until then everything below is empty." />
            </div>
          </Panel>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricTile label="Tenants tracked" value={compact(d.fleet.total)} />
            <MetricTile label="Healthy" value={compact(d.fleet.ok)} />
            <MetricTile label="Warning" value={compact(d.fleet.warn)} tone={d.fleet.warn ? "warn" : undefined} />
            <MetricTile label="Error" value={compact(d.fleet.error)} tone={d.fleet.error ? "bad" : undefined} />
          </div>

          <Panel title="What's broken"
            action={d.freshness?.newest && <span className="text-[10px] text-ink-400">as of {ago(d.freshness.newest)}</span>}>
            {broken === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-bold text-ink-900">Nothing is failing</p>
                <p className="text-[13px] text-ink-600 mt-1">No quality flags, no integration errors, no silent channels.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {d.classes.filter(c => c.count > 0).map((c, i) => (
                  <button key={`${c.key}-${i}`} onClick={() => router.push(`/admin/owner/tenants?queue=${c.key}`)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-control border border-line hover:border-brand-500 transition-colors text-left">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.severity === "critical" ? "bg-red-500" : c.severity === "warn" ? "bg-amber-500" : "bg-brand-500"}`} />
                      <span className="text-[13px] text-ink-900 truncate">{c.label}</span>
                    </span>
                    <Badge tone={c.severity === "critical" ? "bad" : c.severity === "warn" ? "warn" : "info"}>{compact(c.count)}</Badge>
                  </button>
                ))}
                {d.classes.filter(c => c.count === 0).length > 0 && (
                  <p className="text-[11px] text-ink-400 pt-2">
                    Clear: {d.classes.filter(c => c.count === 0).map(c => c.label.toLowerCase()).join(" · ")}
                  </p>
                )}
              </div>
            )}
          </Panel>

          {/* Owner-only Meta env + live Graph credential check. */}
          <MetaDoctor />
        </>
      )}
    </div>
  );
}

function Subsystem({ name, ok, detail, fix }: { name: string; ok: boolean; detail: string; fix: string }) {
  return (
    <div className={`rounded-control border px-3 py-2.5 ${ok ? "border-line" : "border-red-200 bg-red-50/50"}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
        <span className="text-[13px] font-bold text-ink-900">{name}</span>
      </div>
      <p className={`text-[12px] tabular-nums ${ok ? "text-ink-600" : "text-red-600"}`}>{detail}</p>
      {!ok && <p className="text-[11px] text-ink-600 mt-1 leading-snug">{fix}</p>}
    </div>
  );
}
