// Router observability — structured console logs + wa_router_events rows.
// Both are fire-and-forget: metrics must never delay or break a reply.

import { db } from "@/lib/supabase";

export type RouterEvent =
  | "FAQ_MATCH" | "FAQ_MISS"
  | "CACHE_HIT" | "CACHE_MISS"
  | "MEMORY_HIT" | "MEMORY_MISS"
  // A canned FAQ/cache answer was a deflection ("contact our team") but the
  // KB actually covers the question, so we deferred to RAG instead of deflecting.
  | "FAQ_DEFLECT_OVERRIDE" | "CACHE_DEFLECT_OVERRIDE"
  | "RAG_USED";

export function logRouterEvent(p: {
  event: RouterEvent;
  tenantId: string;
  conversationId?: string | null;
  phone?: string;
  question?: string;
  ref?: string;
  score?: number;
  latencyMs?: number;
}): void {
  // Logs carry no personal data: the number is cut to its last four digits and
  // the customer's words are left out (only their length). The full row goes to
  // wa_router_events — tenant-scoped, under retention.ts, and findable by
  // phone for a GDPR export or erasure.
  const { tenantId, conversationId } = p;
  const masked = p.phone ? `…${p.phone.replace(/\D/g, "").slice(-4)}` : null;
  console.log(JSON.stringify({ tag: "router", ts: new Date().toISOString(), tenantId, event: p.event, phone: masked, ref: p.ref, score: p.score, latencyMs: p.latencyMs, qLen: p.question?.length ?? 0 }));
  // tenant_id is what lets a deleted workspace's rows go with it, keeps one
  // tenant's questions out of another's KB test set (kbeval), and lets an
  // erasure find the conversation's rows.
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    conversation_id: conversationId ?? null,
    event: p.event,
    phone: p.phone ?? null,
    question: (p.question ?? "").slice(0, 500),
    ref: p.ref ?? null,
    score: p.score ?? null,
    latency_ms: p.latencyMs ?? null,
  };
  void insertRouterEvent(row);
}

// A database that doesn't have tenant_id / conversation_id yet answers
// 42703/PGRST204; drop them and write the event anyway.
async function insertRouterEvent(row: Record<string, unknown>): Promise<void> {
  try {
    let { error } = await db().from("wa_router_events").insert(row);
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      const { tenant_id: _t, conversation_id: _c, ...bare } = row;
      ({ error } = await db().from("wa_router_events").insert(bare));
    }
    if (error) console.error("[router] event insert failed:", error.message);
  } catch (e) {
    console.error("[router] event insert failed:", e instanceof Error ? e.message : e);
  }
}

export interface RouterStats {
  windowDays: number;
  total: number;
  counts: Record<RouterEvent, number>;
  faqHitRate: number;
  cacheHitRate: number;
  memoryResolvedRate: number;
  ragUsageRate: number;
  avgLatencyMs: Record<string, number>;
  estTokensSaved: number;        // avoided RAG passes × ~2500 tokens each
}

const EVENTS: RouterEvent[] = ["FAQ_MATCH", "FAQ_MISS", "CACHE_HIT", "CACHE_MISS", "MEMORY_HIT", "MEMORY_MISS", "RAG_USED"];
const TOKENS_PER_RAG = 2500;     // rough prompt+context+output cost of one RAG pass

export async function getRouterStats(windowDays = 7): Promise<RouterStats> {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const { data } = await db().from("wa_router_events")
    .select("event, latency_ms").gte("created_at", since).limit(10000);
  const rows = (data ?? []) as { event: RouterEvent; latency_ms: number | null }[];

  const counts = Object.fromEntries(EVENTS.map(e => [e, 0])) as Record<RouterEvent, number>;
  const latSum: Record<string, { sum: number; n: number }> = {};
  for (const r of rows) {
    if (counts[r.event] !== undefined) counts[r.event]++;
    if (r.latency_ms != null) {
      latSum[r.event] ??= { sum: 0, n: 0 };
      latSum[r.event].sum += r.latency_ms; latSum[r.event].n++;
    }
  }
  // One inbound message produces exactly one terminal event: MEMORY_HIT, FAQ_MATCH, CACHE_HIT, or RAG_USED.
  const answered = counts.MEMORY_HIT + counts.FAQ_MATCH + counts.CACHE_HIT + counts.RAG_USED;
  const rate = (n: number) => answered ? Math.round((n / answered) * 1000) / 10 : 0;

  return {
    windowDays,
    total: rows.length,
    counts,
    faqHitRate: rate(counts.FAQ_MATCH),
    cacheHitRate: rate(counts.CACHE_HIT),
    memoryResolvedRate: rate(counts.MEMORY_HIT),
    ragUsageRate: rate(counts.RAG_USED),
    avgLatencyMs: Object.fromEntries(Object.entries(latSum).map(([k, v]) => [k, Math.round(v.sum / v.n)])),
    estTokensSaved: (counts.MEMORY_HIT + counts.FAQ_MATCH + counts.CACHE_HIT) * TOKENS_PER_RAG,
  };
}
