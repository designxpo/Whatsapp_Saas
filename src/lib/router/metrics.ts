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
  phone?: string;
  question?: string;
  ref?: string;
  score?: number;
  latencyMs?: number;
}): void {
  console.log(JSON.stringify({ tag: "router", ts: new Date().toISOString(), ...p }));
  void db().from("wa_router_events").insert({
    event: p.event,
    phone: p.phone ?? null,
    question: (p.question ?? "").slice(0, 500),
    ref: p.ref ?? null,
    score: p.score ?? null,
    latency_ms: p.latencyMs ?? null,
  }).then(({ error }) => { if (error) console.error("[router] event insert failed:", error.message); });
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
