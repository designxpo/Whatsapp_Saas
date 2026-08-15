// Owner console — the denormalised fleet metrics layer.
//
// The problem this solves: deriving one tenant's health costs ~8 queries
// (getTenantHealthSummary fans out to five sub-calls, getTenantUsage does six).
// Doing that per tenant inside a request is what made /api/owner/health
// O(N) and unusable past a few hundred tenants.
//
// So it happens on a rotation instead. A cron sweep recomputes the oldest rows
// first and writes them to tenant_metrics (0106); the console reads that table
// with indexed predicates and shows an explicit "as of" so nobody mistakes a
// rotation for live truth.
//
// What is deliberately NOT here: status, payment_status, plan, trial_ends_at.
// Those live on `tenants`, are indexed by 0106, and are read directly — a stale
// "payment failed" count would be worse than none, so money is never cached.
//
// Everything degrades: a missing table or a failed RPC falls back to the old
// JS path rather than breaking the console, because 0106 is applied by hand and
// there will be a window where it isn't.

import { db } from "./supabase";
import { getTenantHealthSummary } from "./setupstatus";
import { getTenantUsage, getPlanLimits } from "./usage";
import { errorMessage } from "./errors";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface TenantMetrics {
  tenantId: string;
  contacts: number; conversations30d: number; messages30d: number;
  channels: number; channelsReceiving: number; lastInboundAt: string | null;
  waQuality: string | null; waHealth: string | null; marketingPaused: boolean;
  aiConfigured: boolean; kbReady: number; kbTotal: number;
  integrationsActive: number; integrationsErrored: number;
  health: "ok" | "warn" | "error";
  usagePctMax: number;
  refreshedAt: string;
}

export function mapMetrics(r: Record<string, unknown>): TenantMetrics {
  return {
    tenantId: r.tenant_id as string,
    contacts: (r.contacts as number) ?? 0,
    conversations30d: (r.conversations_30d as number) ?? 0,
    messages30d: (r.messages_30d as number) ?? 0,
    channels: (r.channels as number) ?? 0,
    channelsReceiving: (r.channels_receiving as number) ?? 0,
    lastInboundAt: (r.last_inbound_at as string | null) ?? null,
    waQuality: (r.wa_quality as string | null) ?? null,
    waHealth: (r.wa_health as string | null) ?? null,
    marketingPaused: !!r.marketing_paused,
    aiConfigured: !!r.ai_configured,
    kbReady: (r.kb_ready as number) ?? 0,
    kbTotal: (r.kb_total as number) ?? 0,
    integrationsActive: (r.integrations_active as number) ?? 0,
    integrationsErrored: (r.integrations_errored as number) ?? 0,
    health: ((r.health as string) ?? "ok") as TenantMetrics["health"],
    usagePctMax: (r.usage_pct_max as number) ?? 0,
    refreshedAt: r.refreshed_at as string,
  };
}

// ── Utilisation ───────────────────────────────────────────────────────────────

/**
 * The single number behind the "near a plan limit" queue: the highest percentage
 * of any metered resource this tenant has consumed. A limit of 0 means unlimited
 * and contributes nothing. Pure, so the thresholds are testable.
 */
export function maxUsagePct(
  usage: { contacts: number; conversations: number; messages: number; channels: number; seats: number },
  limits: { contacts: number; conversations_per_month: number; messages_per_month: number; channels: number; team_seats: number },
): number {
  const pairs: [number, number][] = [
    [usage.contacts, limits.contacts],
    [usage.conversations, limits.conversations_per_month],
    [usage.messages, limits.messages_per_month],
    [usage.channels, limits.channels],
    [usage.seats, limits.team_seats],
  ];
  let max = 0;
  for (const [used, limit] of pairs) {
    if (limit > 0) max = Math.max(max, Math.round((used / limit) * 100));
  }
  return max;
}

// ── Refresh ───────────────────────────────────────────────────────────────────

/** Recompute one tenant's derived row. Never throws — a bad tenant must not stop the sweep. */
export async function computeTenantMetrics(tenantId: string): Promise<Record<string, unknown>> {
  const [summary, usage, limits, inbound] = await Promise.all([
    getTenantHealthSummary(tenantId).catch(() => null),
    getTenantUsage(tenantId).catch(() => null),
    getPlanLimits(tenantId).catch(() => null),
    lastInboundForTenant(tenantId).catch(() => null),
  ]);
  return {
    tenant_id: tenantId,
    contacts: usage?.contacts ?? 0,
    conversations_30d: usage?.conversations ?? 0,
    messages_30d: usage?.messages ?? 0,
    channels: usage?.channels ?? 0,
    channels_receiving: inbound?.receiving ?? 0,
    last_inbound_at: inbound?.at ?? null,
    // getTenantHealthSummary collapses quality+health into one `flag` string, so
    // read the precise values straight off the channels rather than parse it back.
    ...(await channelSignals(tenantId)),
    ai_configured: !!summary?.ai.configured,
    kb_ready: summary?.kb.ready ?? 0,
    kb_total: summary?.kb.total ?? 0,
    integrations_active: summary?.integrations.active ?? 0,
    integrations_errored: summary?.integrations.errored ?? 0,
    health: summary?.health === "error" ? "error" : summary?.health === "warn" ? "warn" : "ok",
    usage_pct_max: usage && limits ? maxUsagePct(usage, limits) : 0,
    refreshed_at: new Date().toISOString(),
  };
}

/** Worst quality signal across the tenant's WhatsApp channels. */
async function channelSignals(tenantId: string): Promise<Record<string, unknown>> {
  const { data } = await db().from("wa_channels")
    .select("quality_rating, messaging_health, marketing_paused")
    .eq("tenant_id", tenantId).eq("kind", "whatsapp");
  const rows = (data ?? []) as { quality_rating: string | null; messaging_health: string | null; marketing_paused: boolean }[];
  const worst = rows.find(r => r.quality_rating === "RED")
    ?? rows.find(r => r.messaging_health === "FLAGGED" || r.messaging_health === "RESTRICTED")
    ?? rows.find(r => r.quality_rating === "YELLOW")
    ?? rows[0];
  return {
    wa_quality: worst?.quality_rating ?? null,
    wa_health: worst?.messaging_health ?? null,
    marketing_paused: rows.some(r => r.marketing_paused),
  };
}

/** When did anything last arrive, and on how many distinct channels this week? */
async function lastInboundForTenant(tenantId: string): Promise<{ at: string | null; receiving: number }> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [latest, recent] = await Promise.all([
    db().from("wa_conversations").select("last_inbound_at")
      .eq("tenant_id", tenantId).not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("wa_conversations").select("channel_id")
      .eq("tenant_id", tenantId).gte("last_inbound_at", weekAgo).limit(500),
  ]);
  const at = (latest.data as { last_inbound_at?: string } | null)?.last_inbound_at ?? null;
  const ids = new Set(((recent.data ?? []) as { channel_id: string | null }[]).map(r => r.channel_id).filter(Boolean));
  return { at, receiving: ids.size };
}

/**
 * One sweep tick: recompute the least-recently-refreshed tenants. Ordering by
 * refreshed_at makes this a round-robin over the fleet — every tenant is reached
 * eventually, and nothing starves. Bounded by both a batch size and the tick's
 * deadline so it can share a cron invocation safely.
 */
export async function refreshTenantMetrics(limit = 2000, deadlineAt?: number, concurrency = 8): Promise<{ refreshed: number; failed: number }> {
  let refreshed = 0, failed = 0;
  try {
    // Tenants with no row yet sort first (0106 backfills them at epoch).
    const { data, error } = await db().from("tenant_metrics")
      .select("tenant_id").order("refreshed_at", { ascending: true }).limit(limit);
    if (error) throw error;
    const ids = ((data ?? []) as { tenant_id: string }[]).map(r => r.tenant_id);

    // Each tenant costs ~10 round-trips, so serial work would sweep only a few
    // hundred per tick — far too slow to keep 100k rows fresh. Bounded
    // concurrency gets a full fleet sweep into hours instead of days, while the
    // deadline check keeps a slow batch from overrunning the invocation.
    const one = async (tenantId: string) => {
      try {
        const patch = await computeTenantMetrics(tenantId);
        const { error: upErr } = await db().from("tenant_metrics").upsert(patch, { onConflict: "tenant_id" });
        if (upErr) throw upErr;
        refreshed++;
      } catch (err) {
        failed++;
        console.error(`[ownermetrics] refresh ${tenantId} failed:`, errorMessage(err));
        // Stamp it anyway so one poisoned tenant can't wedge the rotation at the
        // front of the queue forever.
        await db().from("tenant_metrics")
          .update({ refreshed_at: new Date().toISOString() }).eq("tenant_id", tenantId)
          .then(() => {}, () => {});
      }
    };

    for (let i = 0; i < ids.length; i += concurrency) {
      if (deadlineAt && Date.now() > deadlineAt) break;
      await Promise.all(ids.slice(i, i + concurrency).map(one));
    }
  } catch (err) {
    console.error("[ownermetrics] sweep failed (is 0106 applied?):", errorMessage(err));
  }
  return { refreshed, failed };
}

/**
 * Give any tenant without a metrics row one, at epoch so the rotation takes it
 * first. Run every tick rather than seeding at signup: a single reconcile can't
 * drift the way a remembered call site can, and it covers tenant rows created by
 * any path — including ones written by hand.
 */
export async function backfillMetricsRows(): Promise<number> {
  const { data, error } = await db().rpc("owner_backfill_metrics");
  if (error) { console.error("[ownermetrics] backfill failed (is 0106 applied?):", error.message); return 0; }
  return Number(data ?? 0);
}

/**
 * Write-through for the one signal that must not wait for the rotation: a
 * WhatsApp number going RED means sends are already being throttled. Called from
 * recordChannelQuality, best-effort.
 */
export async function touchQualityMetrics(tenantId: string, s: { quality?: string | null; health?: string | null; marketingPaused?: boolean }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (s.quality !== undefined) patch.wa_quality = s.quality;
  if (s.health !== undefined) patch.wa_health = s.health;
  if (s.marketingPaused !== undefined) patch.marketing_paused = s.marketingPaused;
  if (!Object.keys(patch).length) return;
  await db().from("tenant_metrics").update(patch).eq("tenant_id", tenantId).then(() => {}, () => {});
}

// ── Aggregate reads ───────────────────────────────────────────────────────────

export interface PlatformStats { total: number; active: number; trialing: number; suspended: number; mrrCents: number }

/** Headline counters in one round-trip. Falls back to the JS path if 0106 is unapplied. */
export async function platformStatsFast(): Promise<PlatformStats> {
  const { data, error } = await db().rpc("owner_platform_stats");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    const { platformStats } = await import("./tenants");
    return platformStats();
  }
  const r = row as Record<string, unknown>;
  return {
    total: Number(r.total ?? 0), active: Number(r.active ?? 0),
    trialing: Number(r.trialing ?? 0), suspended: Number(r.suspended ?? 0),
    mrrCents: Number(r.mrr_cents ?? 0),
  };
}

export interface QueueCount { queue: string; count: number; oldest: string | null }

/** Every work-queue count in a single round-trip. Empty array if 0106 is unapplied. */
export async function queueCounts(): Promise<QueueCount[]> {
  const { data, error } = await db().rpc("owner_queue_counts");
  if (error) { console.error("[ownermetrics] queue counts unavailable (is 0106 applied?):", error.message); return []; }
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    queue: r.queue as string, count: Number(r.count ?? 0), oldest: (r.oldest as string | null) ?? null,
  }));
}

export async function planMix(): Promise<{ plan: string; count: number }[]> {
  const { data, error } = await db().rpc("owner_plan_mix");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({ plan: r.plan as string, count: Number(r.count ?? 0) }));
}

export async function signupsByDay(days = 30): Promise<{ date: string; count: number }[]> {
  const { data, error } = await db().rpc("owner_signups_by_day", { p_days: days });
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({ date: String(r.day), count: Number(r.count ?? 0) }));
}

/** How fresh is the rotation? Drives the "as of" line on every derived number. */
export async function metricsFreshness(): Promise<{ oldest: string | null; newest: string | null; rows: number }> {
  const [oldest, newest, count] = await Promise.all([
    db().from("tenant_metrics").select("refreshed_at").order("refreshed_at", { ascending: true }).limit(1).maybeSingle(),
    db().from("tenant_metrics").select("refreshed_at").order("refreshed_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("tenant_metrics").select("tenant_id", { count: "exact", head: true }),
  ]);
  return {
    oldest: (oldest.data as { refreshed_at?: string } | null)?.refreshed_at ?? null,
    newest: (newest.data as { refreshed_at?: string } | null)?.refreshed_at ?? null,
    rows: count.count ?? 0,
  };
}

/** The owner's own workspace is not a customer — exclude it from fleet views. */
export const EXCLUDE_DEFAULT_TENANT = DEFAULT_TENANT_ID;
