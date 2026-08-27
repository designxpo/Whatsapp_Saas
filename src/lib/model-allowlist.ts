// The only models this app may spend the PLATFORM's Gemini key on.
//
// Scope matters here, and it is narrower than it looks. This build is
// BYO-key: resolveTenantAi() returns each tenant's OWN provider, model and
// key, and chat + voice transcription both run on that. A tenant choosing an
// expensive model spends their own money, on their own account, and may
// legitimately want a model newer than anything we would have listed — so
// imposing a fixed list there would be both presumptuous and wrong (it also
// supports OpenAI and Anthropic, which a Gemini-named allowlist would reject
// outright).
//
// The platform key (process.env.GEMINI_API_KEY) is used in exactly one place:
// embeddings, in kb.ts. That is the only platform-funded model call, so it is
// the only one this list governs.
//
// Why it exists: in Aug 2026 the platform Gemini project was flagged by Google
// for suspicious activity, with four Gemini 3.x models and Nano Banana Pro
// (Gemini 3 Pro Image) consuming 228K output tokens in a day. None of that came
// from this app, but nothing here constrained which model the platform key
// could be pointed at either.
//
// For embeddings there is a second, sharper reason: a wrong model returns
// vectors of a different dimension, which silently corrupts kb_chunks and every
// retrieval that reads them. That failure is worse than an unexpected bill
// because it is invisible until answers quietly get worse.

const EMBED = ["gemini-embedding-001"] as const;

export const ALLOWED_EMBED_MODELS: readonly string[] = EMBED;

/**
 * Resolves a requested embedding model to one the platform key may call.
 *
 * Falls back rather than throwing: a typo in an env var should not take the
 * knowledge base offline, and the fallback is itself approved so the spend is
 * always sanctioned. The rejection is logged under a fixed tag so it can be
 * grepped or alerted on instead of passing unnoticed.
 */
export function resolveEmbedModel(
  requested: string | null | undefined,
  fallback: string,
  source: string,
): string {
  const want = (requested ?? "").trim();
  if (!want) return fallback;
  if (EMBED.includes(want as (typeof EMBED)[number])) return want;

  console.warn(
    JSON.stringify({
      tag: "model_not_allowed",
      requested: want,
      kind: "embed",
      source,
      usedInstead: fallback,
      allowed: EMBED,
    }),
  );
  return fallback;
}

/** True when a model may be used for platform-funded embeddings. */
export function isEmbedModelAllowed(model: string | null | undefined): boolean {
  const m = (model ?? "").trim();
  return m.length > 0 && EMBED.includes(m as (typeof EMBED)[number]);
}
