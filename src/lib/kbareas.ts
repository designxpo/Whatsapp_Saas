// Subject areas for the knowledge library — INFERRED from the content, not declared.
//
// A workspace sells something specific (rooms, treatments, subscriptions, repairs)
// and a fixed list of shelves chosen in advance can only ever fit the business it
// was written for. So there is no list. A model reads each concept, files it under
// one of the workspace's EXISTING areas when it plausibly belongs there, and only
// when nothing fits proposes a new, plainly named one in the business's own words.
//
// Sprawl is the failure mode of that freedom — fifty one-concept areas is no
// structure at all — so it is bounded three ways: the prompt says to prefer
// existing areas and to name broad subjects rather than individual facts, the
// number of areas is capped, and anything over the cap lands in a catch-all
// instead of creating another shelf.
//
// With no AI key (or a failed call) filing falls back to coarse keyword hints from
// kblibrary.ts. Those hints are a fallback only: they never limit which areas can
// exist, and what they cannot place stays unfiled for a person.

import { classifyByKeywords } from "./kblibrary";
import { resolveTenantAi } from "./ai/keys";
import { runChat } from "./ai/chat";
import { errorMessage } from "./errors";
import { DEFAULT_TENANT_ID } from "./tenant";

/** Most areas a workspace's library grows to before new subjects share a catch-all. */
export const MAX_AREAS = 14;
/** Where subjects land once the cap is reached. */
export const CATCH_ALL = "general";
/** Concepts judged per model call. */
const BATCH = 20;
/** How much of a concept the model reads — enough to tell what it is about. */
const SNIPPET_CHARS = 360;

/** A directory-safe area name, or null when nothing usable is left. */
export function areaSlug(raw: unknown): string | null {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : null;
}

/** "room-types" → "Room types". The shelf's name as a person reads it. */
export function areaTitle(slug: string): string {
  const t = String(slug ?? "").replace(/-+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Unfiled";
}

export interface AreaAssignment {
  /** The area slug, or null = unfiled, for a person to place. */
  area: string | null;
  /** 0..1. A model placement is trusted; a keyword one reports its own margin. */
  confidence: number;
  source: "model" | "keywords" | "none";
}

export interface ConceptSnippet { title: string; text: string }

const SYSTEM = `You organise a business's knowledge base into subject areas by reading what each piece of content is ABOUT.

Rules:
- Use the business's own vocabulary. Do not assume any industry.
- An area is a broad shelf holding many related facts (for example "pricing", "room types", "opening hours", "treatments", "delivery"), not one individual fact.
- Strongly prefer an EXISTING area whenever the content plausibly belongs there.
- Create a new area only when nothing existing fits. Name it with 1 to 3 plain lowercase words.
- Keep the total number of areas small; never invent an area for a single minor detail.

Reply with ONLY a JSON array, one object per item, in order: [{"i":0,"area":"pricing"}, ...]. "area" is an existing area name or a new one.`;

/** Pull the first JSON array out of a model reply, tolerating code fences and chatter. */
export function parseAssignments(reply: string): { i: number; area: unknown }[] {
  const text = String(reply ?? "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr)
      ? arr.filter((x): x is { i: number; area: unknown } => !!x && typeof x === "object" && Number.isInteger((x as { i: unknown }).i))
      : [];
  } catch { return []; }
}

function keywordFallback(item: ConceptSnippet, minConfidence: number): AreaAssignment {
  const { area, confidence } = classifyByKeywords(`${item.title}\n${item.text}`);
  return area && confidence >= minConfidence
    ? { area, confidence, source: "keywords" }
    : { area: null, confidence: 0, source: "none" };
}

/**
 * Decide an area for each concept.
 *
 * `existing` is the workspace's current set of area slugs; it grows as this call
 * proposes new ones, so later batches reuse what earlier batches created.
 */
export async function assignAreas(
  items: ConceptSnippet[],
  existing: string[],
  tenantId = DEFAULT_TENANT_ID,
  opts: { minKeywordConfidence?: number } = {},
): Promise<AreaAssignment[]> {
  const minKw = opts.minKeywordConfidence ?? 0.15;
  const out: AreaAssignment[] = items.map(() => ({ area: null, confidence: 0, source: "none" as const }));
  if (!items.length) return out;

  const areas = new Set(existing.map(a => areaSlug(a)).filter((a): a is string => !!a));
  let ai: Awaited<ReturnType<typeof resolveTenantAi>> | null = null;
  try { ai = await resolveTenantAi(tenantId); }
  catch { /* no key configured — keywords only */ }

  for (let from = 0; from < items.length; from += BATCH) {
    const batch = items.slice(from, from + BATCH);
    let picked: Map<number, string> | null = null;

    if (ai) {
      try {
        const list = [...areas].map(a => `- ${a}`).join("\n") || "(none yet)";
        const body = batch.map((it, i) => `#${i} ${it.title}\n${it.text.slice(0, SNIPPET_CHARS).replace(/\s+/g, " ")}`).join("\n\n");
        const res = await runChat({
          provider: ai.provider, apiKey: ai.apiKey, model: ai.model, system: SYSTEM,
          turns: [{ role: "user", text: `Existing areas:\n${list}\n\nMaximum total areas: ${MAX_AREAS}.\n\nItems:\n\n${body}` }],
          maxTokens: 1200, timeoutMs: 45_000,
        });
        picked = new Map();
        for (const a of parseAssignments(res.text)) {
          const slug = areaSlug(a.area);
          if (slug && a.i >= 0 && a.i < batch.length) picked.set(a.i, slug);
        }
      } catch (err) {
        console.error("[kb] area classification failed — using keyword hints:", errorMessage(err));
        picked = null;
      }
    }

    batch.forEach((item, i) => {
      const slug = picked?.get(i);
      if (slug) {
        // A new area is allowed until the cap; after it, new subjects share a catch-all.
        const final = areas.has(slug) || areas.size < MAX_AREAS ? slug : CATCH_ALL;
        areas.add(final);
        out[from + i] = { area: final, confidence: 0.8, source: "model" };
      } else {
        const kw = keywordFallback(item, minKw);
        if (kw.area) areas.add(kw.area);
        out[from + i] = kw;
      }
    });
  }
  return out;
}
