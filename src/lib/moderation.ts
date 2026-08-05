// Content safety layer — every outbound message, public reply and piece of
// media passes through here before it can reach a customer or be posted under
// this platform's Meta / Google app credentials.
//
// WHY THIS EXISTS AT THE PLATFORM LEVEL (not per tenant): public comment
// replies, DMs and review replies are posted using the SHARED Tech Provider
// app. One tenant sending abusive content puts every other tenant's channel
// access at risk, so this check is deliberately NOT on the tenant's own AI key
// or a per-tenant toggle they can switch off.
//
// TWO LAYERS, and the ORDER is the important part:
//   1. OpenAI's moderation endpoint (omni-moderation-latest) — free, and the
//      only one that scores text AND images through a single call. Asked first;
//      when it answers, its verdict is final. Separate from the tenant's own
//      bring-your-own AI key by design (see above), so it still runs when a
//      tenant picked Gemini or Anthropic for their replies.
//   2. A local keyword list — the FALLBACK, used only when layer 1 is
//      unreachable or unconfigured. It has no context, so it must never
//      pre-empt the model; see the comment on BLOCKED_PATTERNS for the terms
//      that were removed after testing showed they block real business copy.
//
// FAILURE POSTURE — read this before changing it:
//   * Not configured (no key)      → keyword fallback only. The hosted check is
//     inert until MODERATION_API_KEY is set, matching how every other
//     integration here stays dormant until its env var exists — but protection
//     is never zero.
//   * Configured, content flagged  → BLOCK + log. This is the enforcement path.
//   * Configured, API call fails   → keyword fallback + a loud log. A
//     third-party outage must not take every tenant's replies offline
//     platform-wide; that would trade a brief window at today's risk level for
//     a real, total outage. Logged as moderation_api_unavailable so the
//     degraded window is visible rather than silent.

import { db } from "./supabase";

const MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = "omni-moderation-latest";
const EXCERPT_MAX = 500;

export type ModerationSurface =
  | "ai_reply" | "comment_reply" | "dm_reply" | "review_reply"
  | "upload" | "product_image" | "broadcast_media"
  | "flow_text" | "quick_reply" | "sequence_text" | "comment_rule";

export interface ModerationVerdict {
  allowed: boolean;
  reason?: string;          // categories that tripped, or "keyword:<term>"
}

export interface ModerationContext {
  tenantId?: string;
  surface: ModerationSurface;
}

export function moderationConfigured(): boolean {
  return !!process.env.MODERATION_API_KEY;
}

// ── Layer 1: local pre-filter ────────────────────────────────────────────────
// EXTREMELY narrow on purpose, and it stays that way. This layer has no context,
// so anything context-dependent belongs to the API check instead — a regex that
// blocks legitimate business messages is a worse product failure than one that
// waves through a borderline word the hosted model would have caught anyway.
//
// Terms deliberately NOT here, because testing showed each blocks real copy:
//   "kike"   → a common Spanish given name (Enrique → Kike)
//   "tranny" → standard automotive slang for a transmission
//   "chink"  → "chink-free finish", "a chink in the armour"
//   "spic"   → substring risk around spice/specify/specific
//   "retard" → "flame retardant", "retarded growth" in older business prose
//   "cp"     → ordinary shorthand (cost-per, channel partner, control panel)
// Every one of those is a case a context-aware model judges correctly and a
// word list does not. Do not re-add them here.
const BLOCKED_PATTERNS: { term: string; re: RegExp }[] = [
  // Slurs with no defensible use in a business message, word-boundary matched
  // (so "niggardly" and similar unrelated words can't trip them).
  { term: "slur", re: /\b(n[i1]gg(?:er|a)s?|f[a4]ggots?)\b/i },
  // Explicit threats of violence aimed at a person. Requires an object ("you",
  // "him", …) so "kill the campaign" / "we killed it" stay clean.
  { term: "threat", re: /\b(i(?:'?m| am|ll| will)\s+(?:going to\s+)?(?:kill|murder|rape|behead)\s+(?:you|u|him|her|them)|kill\s+yourself|kys)\b/i },
  // Child-safety terms — zero tolerance, and none of these has an innocent
  // reading (the over-broad "cp links" variant was removed; see above).
  { term: "csam", re: /\b(child\s*p[o0]rn\w*|preteen\s*(?:nude|sex)|loli(?:con)?\s*porn)\b/i },
];

function keywordScan(text: string): string | null {
  for (const { term, re } of BLOCKED_PATTERNS) {
    if (re.test(text)) return `keyword:${term}`;
  }
  return null;
}

// ── Layer 2: hosted moderation ───────────────────────────────────────────────
type ModerationInput = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function callModerationApi(input: ModerationInput[]): Promise<{ flagged: boolean; categories: string[] } | null> {
  try {
    const r = await fetch(MODERATION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MODERATION_API_KEY as string}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODERATION_MODEL, input }),
      // A moderation check sits in the reply path — it must not hang a webhook.
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { results?: { flagged?: boolean; categories?: Record<string, boolean> }[] };
    const results = j.results ?? [];
    if (!results.length) return null;
    const categories = new Set<string>();
    let flagged = false;
    for (const res of results) {
      if (res.flagged) flagged = true;
      for (const [name, hit] of Object.entries(res.categories ?? {})) {
        if (hit) categories.add(name);
      }
    }
    return { flagged, categories: [...categories] };
  } catch {
    return null;   // network error / timeout / malformed response
  }
}

// Short-lived verdict cache. The same string is legitimately screened more than
// once per request — generateReply() checks a reply, then the channel sender
// checks it again as the last-line backstop — and identical broadcast/sequence
// copy repeats across recipients. Caching keeps that from becoming N API calls
// and N× latency. Keyed by exact text; TTL is short so a policy change or a
// transient outage verdict can't stick around.
const VERDICT_TTL_MS = 5 * 60 * 1000;
const VERDICT_CACHE_MAX = 500;
const verdictCache = new Map<string, { verdict: ModerationVerdict; at: number }>();

function cachedVerdict(key: string): ModerationVerdict | null {
  const hit = verdictCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > VERDICT_TTL_MS) { verdictCache.delete(key); return null; }
  return hit.verdict;
}

function cacheVerdict(key: string, verdict: ModerationVerdict): void {
  // Plain FIFO eviction — cheap, and a wrong eviction only costs one extra call.
  if (verdictCache.size >= VERDICT_CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest !== undefined) verdictCache.delete(oldest);
  }
  verdictCache.set(key, { verdict, at: Date.now() });
}

async function logBlock(ctx: ModerationContext, kind: "text" | "image", reason: string, excerpt: string): Promise<void> {
  try {
    await db().from("wa_moderation_log").insert({
      tenant_id: ctx.tenantId ?? null,
      surface: ctx.surface,
      kind,
      reason,
      excerpt: excerpt.slice(0, EXCERPT_MAX),
    });
  } catch {
    // Never let an audit-log write failure change the enforcement decision —
    // the block itself already happened; losing the log row is the lesser evil.
  }
  console.warn(JSON.stringify({ tag: "moderation_block", surface: ctx.surface, kind, reason, tenantId: ctx.tenantId }));
}

// ── Public API ───────────────────────────────────────────────────────────────

// Screen outbound text. Returns allowed:false ONLY on a real positive — see the
// failure-posture note at the top of this file.
// Order matters: the context-aware API is asked FIRST and its verdict is final
// when it answers. The keyword list is only consulted when the API can't be
// reached (or isn't configured) — so a term that reads badly out of context but
// is fine in context ("faggots and peas" on a British pub menu) is judged by the
// model rather than hard-blocked by a word match that cannot know the context.
export async function moderateText(text: string, ctx: ModerationContext): Promise<ModerationVerdict> {
  const body = (text ?? "").trim();
  if (!body) return { allowed: true };

  const cached = cachedVerdict(body);
  if (cached) return cached;

  if (moderationConfigured()) {
    const res = await callModerationApi([{ type: "text", text: body.slice(0, 8000) }]);
    if (res) {
      if (!res.flagged) {
        cacheVerdict(body, { allowed: true });
        return { allowed: true };
      }
      const reason = res.categories.join(",") || "flagged";
      await logBlock(ctx, "text", reason, body);
      const verdict = { allowed: false, reason };
      cacheVerdict(body, verdict);
      return verdict;
    }
    console.warn(JSON.stringify({ tag: "moderation_api_unavailable", surface: ctx.surface, tenantId: ctx.tenantId }));
    // Not cached — an outage verdict must not be remembered once the API is back.
  }

  const keywordHit = keywordScan(body);
  if (keywordHit) {
    await logBlock(ctx, "text", keywordHit, body);
    return { allowed: false, reason: keywordHit };
  }
  return { allowed: true };
}

// Screen an image by URL. The moderation endpoint fetches the URL itself, so
// this works for both our own storage URLs and a pasted third-party link.
export async function moderateImageUrl(url: string, ctx: ModerationContext): Promise<ModerationVerdict> {
  const clean = (url ?? "").trim();
  if (!clean || !moderationConfigured()) return { allowed: true };

  const res = await callModerationApi([{ type: "image_url", image_url: { url: clean } }]);
  if (!res) {
    console.warn(JSON.stringify({ tag: "moderation_api_unavailable", surface: ctx.surface, kind: "image", tenantId: ctx.tenantId }));
    return { allowed: true };
  }
  if (res.flagged) {
    const reason = res.categories.join(",") || "flagged";
    await logBlock(ctx, "image", reason, clean);
    return { allowed: false, reason };
  }
  return { allowed: true };
}

// Screen an image File's BYTES, before it's stored anywhere. Used by the upload
// endpoint so unsafe media never reaches public storage at all (as opposed to
// uploading first and deleting after, which briefly exposes it).
//
// Non-images pass through: this endpoint also accepts PDFs, Office docs, video
// and audio, none of which the moderation model scores. Video especially is a
// real remaining gap — see the note in .env.example.
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_SCAN_MAX_BYTES = 8 * 1024 * 1024;   // base64 inflates ~33%; keep the request sane

export async function moderateImageFile(file: File, ctx: ModerationContext): Promise<ModerationVerdict> {
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!moderationConfigured() || !IMAGE_MIMES.has(mime)) return { allowed: true };
  // An image too big to scan is REJECTED, not waved through: the size is fully
  // attacker-controlled, so allowing it would let anyone defeat this check by
  // padding a file past the cap. The upload limit is 25MB, so a legitimate
  // product photo has room — and the caller shows a "compress it" message.
  if (file.size > IMAGE_SCAN_MAX_BYTES) {
    await logBlock(ctx, "image", "too_large_to_scan", `${mime}:${file.size}b`);
    return { allowed: false, reason: "too_large_to_scan" };
  }

  const dataUrl = `data:${mime};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  const res = await callModerationApi([{ type: "image_url", image_url: { url: dataUrl } }]);
  if (!res) {
    console.warn(JSON.stringify({ tag: "moderation_api_unavailable", surface: ctx.surface, kind: "image", tenantId: ctx.tenantId }));
    return { allowed: true };
  }
  if (res.flagged) {
    const reason = res.categories.join(",") || "flagged";
    await logBlock(ctx, "image", reason, `upload:${mime}:${file.size}b`);
    return { allowed: false, reason };
  }
  return { allowed: true };
}

// Convenience for save-time validation paths that should reject with a message
// the admin actually sees. Throws so an API route's existing catch turns it
// into a 4xx/5xx with this text, rather than every caller re-writing the copy.
export async function assertTextAllowed(text: string, ctx: ModerationContext): Promise<void> {
  const verdict = await moderateText(text, ctx);
  if (!verdict.allowed) {
    throw new Error("This content was blocked by the safety filter — it may violate WhatsApp, Meta or Google content policies. Edit the wording and try again.");
  }
}

export async function assertImageAllowed(url: string, ctx: ModerationContext): Promise<void> {
  const verdict = await moderateImageUrl(url, ctx);
  if (!verdict.allowed) {
    throw new Error("This image was blocked by the safety filter — it may violate WhatsApp, Meta or Google content policies. Use a different image.");
  }
}

// Screen several fields of one saved object (a flow's node text, a rule's reply
// variants) in a SINGLE moderation call. Batching keeps a save that touches
// dozens of strings from firing dozens of requests; the tradeoff is a block
// names the object, not which specific field tripped — acceptable at save time,
// where the admin is looking at all of them anyway.
export async function assertTextsAllowed(texts: (string | null | undefined)[], ctx: ModerationContext): Promise<void> {
  const joined = texts.map(t => (t ?? "").trim()).filter(Boolean).join("\n");
  if (joined) await assertTextAllowed(joined, ctx);
}

// Pulls every human-readable string out of an arbitrarily-shaped object (a flow
// graph's untyped node `data`, for instance) so configured copy can be screened
// without hard-coding which fields hold text. Skips url/href/image-ish keys —
// those are media, screened separately, and would otherwise be scored as prose.
const NON_TEXT_KEY = /(^|_)(url|href|src|image|icon|media|ids?|keys?|token|colou?r)s?($|_)/;
// Field names here are camelCase (imageUrl, mediaUrl, channelIds), so the key is
// split on case boundaries before matching — a plain snake_case pattern silently
// missed all of them and scored URLs as prose.
function isNonTextKey(key: string): boolean {
  return NON_TEXT_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
}
export function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(v => collectStrings(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !isNonTextKey(k))
      .flatMap(([, v]) => collectStrings(v, depth + 1));
  }
  return [];
}
