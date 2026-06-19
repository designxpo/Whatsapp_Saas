import { DEFAULT_TENANT_ID } from "../tenant";
// Semantic Cache — Layer 2 of the Knowledge Router. Scoped per tenant.
// Two-step lookup: free exact-normalized-text hit first, then pgvector cosine
// similarity (one embedding call — still far cheaper than a full RAG pass).

import { db } from "@/lib/supabase";
import { embedQuery } from "@/lib/kb";
import { normalize } from "./faq";


// Paraphrase-level similarity. Below this we risk serving a wrong cached answer.
const CACHE_SIMILARITY = 0.92;

// The cache is shared across a tenant's customers, so it must only ever hold
// generic, reusable answers. An answer that greets a specific person by name
// ("Hi Govind!", "Hello Basit Kamal!") is conversation-specific — caching it
// would replay one customer's name (and context) to another. Detect a greeting
// immediately followed by a capitalised name, so "Hi there!" / "Hi! 👋 We…" stay
// cacheable.
const PERSONALIZED_GREETING = /^\s*\*{0,2}\s*(?:[Hh]i+|[Hh]ello+|[Hh]ey+|[Nn]amaste|[Dd]ear)\s+[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?\s*[,!.]/;
export function isPersonalizedAnswer(answer: string): boolean {
  return PERSONALIZED_GREETING.test(answer || "");
}

async function purgeCache(id: string): Promise<void> {
  try { await db().from("wa_semantic_cache").delete().eq("id", id); } catch { /* best-effort */ }
}

export interface CacheHit {
  id: string;
  answer: string;
  similarity: number;
  exact: boolean;
}

export interface CacheLookup {
  hit: CacheHit | null;
  embedding: number[] | null;   // returned so the RAG path can reuse it for the write
}

export async function cacheLookup(question: string, precomputed?: number[] | null, tenantId = DEFAULT_TENANT_ID): Promise<CacheLookup> {
  const norm = normalize(question);
  if (!norm) return { hit: null, embedding: null };

  // Step 1 — exact normalized text (no embedding call), scoped to the tenant.
  const exact = await db().from("wa_semantic_cache")
    .select("id, answer").eq("tenant_id", tenantId).eq("normalized_question", norm).maybeSingle();
  if (exact.data) {
    const ans = exact.data.answer as string;
    // Pre-fix poison: an old personalised entry must not be served — drop it and
    // fall through to RAG so this customer gets a fresh, generic answer.
    if (isPersonalizedAnswer(ans)) { void purgeCache(exact.data.id as string); }
    else {
      void bumpHit(exact.data.id as string);
      return { hit: { id: exact.data.id as string, answer: ans, similarity: 1, exact: true }, embedding: null };
    }
  }

  // Step 2 — vector similarity (reuse the caller's embedding when provided).
  const embedding = precomputed ?? await embedQuery(question);
  const { data } = await db().rpc("match_semantic_cache", { query_embedding: embedding, match_count: 1, p_tenant_id: tenantId });
  const top = (data as { id: string; answer: string; similarity: number }[] | null)?.[0];
  if (top && top.similarity >= CACHE_SIMILARITY) {
    if (isPersonalizedAnswer(top.answer)) { void purgeCache(top.id); return { hit: null, embedding }; }
    void bumpHit(top.id);
    return { hit: { id: top.id, answer: top.answer, similarity: top.similarity, exact: false }, embedding };
  }
  return { hit: null, embedding };
}

async function bumpHit(id: string): Promise<void> {
  try {
    const { data } = await db().from("wa_semantic_cache").select("hit_count").eq("id", id).single();
    await db().from("wa_semantic_cache")
      .update({ hit_count: ((data?.hit_count as number) ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", id);
  } catch { /* metrics only — never block the reply */ }
}

// Store a RAG-produced answer. Reuses the lookup's embedding when available.
// The cache is tenant-scoped — answers must never cross tenants.
export async function cacheStore(question: string, answer: string, embedding: number[] | null, source = "rag", tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    const norm = normalize(question);
    if (!norm || !answer.trim()) return;
    // Never cache a name-personalised answer — the cache is shared across customers.
    if (isPersonalizedAnswer(answer)) return;
    const emb = embedding ?? await embedQuery(question);
    // Unique on (tenant_id, normalized_question) — concurrent dup inserts no-op.
    await db().from("wa_semantic_cache").upsert(
      { tenant_id: tenantId, question, normalized_question: norm, answer, source, embedding: emb },
      { onConflict: "tenant_id,normalized_question", ignoreDuplicates: true },
    );
  } catch (e) {
    console.error("[router] cacheStore failed:", e);
  }
}
