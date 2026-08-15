"use client";

// Today — the console's front door.
//
// The old Overview showed five counters, a plan-mix strip and a scrolling audit
// feed. All true, none actionable: nothing on it told an operator what to do
// next. At 100k tenants that's fatal, because there is no version of "look
// through the list" that works.
//
// So this screen is a queue board. Every card is a filtered slice of the fleet
// that needs a human, with the age of its oldest item, and clicking it opens
// exactly those tenants. When every queue is clear the screen says so — "nothing
// needs you" is a real, reachable state, and an operator who can trust that can
// stop checking.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, RefreshCw, Radio } from "lucide-react";
import { QUEUES, QUEUE_GROUPS, QUEUE_BY_KEY } from "@/lib/ownerqueues";
import { MetricTile, QueueCard, Panel, Badge, Spinner, money, compact, ago } from "./_ui";

type QueueCount = { queue: string; count: number; oldest: string | null };
type Payload = {
  queues: QueueCount[];
  stats: { total: number; active: number; trialing: number; suspended: number; mrrCents: number };
  freshness: { oldest: string | null; newest: string | null; rows: number } | null;
  platform: { cronLastTick: string | null; cronAgeMin: number | null; cronOk: boolean; crmSync: { pending: number; dead: number } };
  error?: string;
};

export default function TodayPage() {
  const router = useRouter();
  const [d, setD] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/queues");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); setD(null); }
      else { setErr(null); setD(j); }
    } catch { setErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKey = new Map((d?.queues ?? []).map(q => [q.queue, q]));
  const total = (d?.queues ?? []).reduce((s, q) => s + q.count, 0);
  const critical = QUEUES.filter(q => q.severity === "critical").reduce((s, q) => s + (byKey.get(q.key)?.count ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Today</h1>
          <p className="text-sm text-ink-600">
            {loading ? "Checking the fleet…"
              : critical > 0 ? `${compact(critical)} account${critical === 1 ? "" : "s"} need attention now.`
              : total > 0 ? "Nothing urgent. A few things are worth a look."
              : "Nothing needs you."}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      {/* Platform first: these are the failures that hit every tenant at once, so
          a red line here outranks any per-tenant queue below. */}
      {d && <PlatformStrip platform={d.platform} freshness={d.freshness} />}

      {d && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricTile label="Tenants" value={compact(d.stats.total)} />
          <MetricTile label="Active" value={compact(d.stats.active)} />
          <MetricTile label="Trialing" value={compact(d.stats.trialing)} />
          <MetricTile label="Suspended" value={compact(d.stats.suspended)} tone={d.stats.suspended > 0 ? "warn" : undefined}
            onClick={() => router.push("/admin/owner/tenants?queue=suspended")} />
          <MetricTile label="MRR" value={money(d.stats.mrrCents)} />
        </div>
      )}

      {loading && !d && <div className="flex justify-center py-16"><Spinner /></div>}

      {d && total === 0 && (
        <Panel>
          <div className="text-center py-10">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-base font-extrabold text-ink-900">Every queue is clear</p>
            <p className="text-[13px] text-ink-600 mt-1 max-w-md mx-auto leading-relaxed">
              No failed payments, no broken channels, no stalled onboarding. Nothing on the fleet needs a human right now.
            </p>
          </div>
        </Panel>
      )}

      {d && total > 0 && QUEUE_GROUPS.map(g => {
        const items = QUEUES.filter(q => q.group === g.key);
        const groupTotal = items.reduce((s, q) => s + (byKey.get(q.key)?.count ?? 0), 0);
        if (!groupTotal) return null;   // a clear group is not worth the vertical space
        return (
          <section key={g.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-[11px] font-bold text-ink-400 uppercase tracking-[0.06em]">{g.title}</h2>
              <span className="text-[11px] text-ink-400 tabular-nums">{compact(groupTotal)}</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(q => {
                const c = byKey.get(q.key);
                if (!c?.count) return null;
                return (
                  <QueueCard key={q.key} title={q.title} why={q.why} count={c.count} oldest={c.oldest}
                    severity={q.severity} stale={q.source === "derived"}
                    onClick={() => router.push(`/admin/owner/tenants?queue=${q.key}`)} />
                );
              })}
            </div>
          </section>
        );
      })}

      {d && total > 0 && (
        <p className="text-[11px] text-ink-400">
          Revenue and trial queues read live. Delivery and onboarding queues come from the last fleet sweep
          {d.freshness?.newest ? ` (${ago(d.freshness.newest)})` : ""}.
          Clear queues are hidden — {QUEUES.length - (d.queues.filter(q => q.count > 0).length)} of {QUEUES.length} are currently clear.
        </p>
      )}
    </div>
  );
}

function PlatformStrip({ platform, freshness }: { platform: Payload["platform"]; freshness: Payload["freshness"] }) {
  const sweepStale = freshness?.oldest ? Date.now() - new Date(freshness.oldest).getTime() > 6 * 3600_000 : false;
  const problems = !platform.cronOk || platform.crmSync.dead > 0 || sweepStale;
  return (
    <Panel dense>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink-400 uppercase tracking-[0.06em]">
          <Radio className="w-3.5 h-3.5" /> Platform
        </span>
        <Item label="Background engine"
          tone={platform.cronOk ? "ok" : "bad"}
          value={platform.cronAgeMin === null ? "never run" : platform.cronOk ? `ticking · ${platform.cronAgeMin}m ago` : `stalled · ${platform.cronAgeMin}m ago`}
          hint={!platform.cronOk ? "Everything queue-driven is stopped — check the GitHub Actions cron and CRON_URL." : undefined} />
        <Item label="CRM sync"
          tone={platform.crmSync.dead > 0 ? "bad" : platform.crmSync.pending > 500 ? "warn" : "ok"}
          value={`${compact(platform.crmSync.pending)} pending · ${compact(platform.crmSync.dead)} dead`} />
        <Item label="Fleet sweep"
          tone={sweepStale ? "warn" : "ok"}
          value={freshness?.rows ? `${compact(freshness.rows)} rows · oldest ${ago(freshness.oldest)}` : "not run yet"}
          hint={!freshness?.rows ? "Apply migration 0106 and let the tenant-metrics cron run once." : undefined} />
        {!problems && <Badge tone="ok">all systems normal</Badge>}
      </div>
    </Panel>
  );
}

function Item({ label, value, tone, hint }: { label: string; value: string; tone: "ok" | "warn" | "bad"; hint?: string }) {
  const dot = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="min-w-0" title={hint}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="text-[11px] font-bold text-ink-900">{label}</span>
      </div>
      <p className={`text-[11px] tabular-nums ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-ink-600"}`}>{value}</p>
      {hint && <p className="text-[10px] text-ink-400 max-w-xs leading-snug">{hint}</p>}
    </div>
  );
}
