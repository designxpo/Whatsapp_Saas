// Grounds the AI ad planner in the tenant's REAL Meta account data, so the
// campaign it drafts uses valid targeting and realistic reach — not the model's
// guesses. Three jobs:
//   • gatherGrounding()  — pre-plan context: what worked before + saved audiences
//                          (fed into the copywriting prompt).
//   • groundAdSets()     — post-plan validation loop: resolve each ad set's
//                          proposed interests to real Meta interest IDs
//                          (searchTargeting), estimate its reach
//                          (estimateAudience), flag audiences that are too
//                          narrow/broad, and — via an optional `reask` callback —
//                          let the model broaden the flagged ones ONCE.
//
// Every Graph call is best-effort: if the account isn't configured or Meta
// errors, we degrade to "unknown" and the planner still returns an editable
// draft. Meta access is injected (GroundingDeps) so this is unit-testable
// without touching the network — see adgrounding.test.ts.

import {
  searchTargeting,
  estimateAudience,
  listCustomAudiences,
  listAdCampaigns,
  type AdObjective,
} from "./ads";

export interface GroundingDeps {
  searchTargeting: typeof searchTargeting;
  estimateAudience: typeof estimateAudience;
  listCustomAudiences: typeof listCustomAudiences;
  listAdCampaigns: typeof listAdCampaigns;
}
const realDeps: GroundingDeps = { searchTargeting, estimateAudience, listCustomAudiences, listAdCampaigns };

// Reach bands. An audience Meta estimates below NARROW rarely delivers well on a
// conversation/traffic objective; above BROAD it's usually unfocused. Exported
// so tests (and the UI copy) share the exact thresholds.
export const REACH_NARROW = 50_000;
export const REACH_BROAD = 30_000_000;
export type ReachStatus = "ok" | "narrow" | "broad" | "unknown";

export function reachStatusOf(lower?: number, upper?: number): ReachStatus {
  const top = upper ?? lower;
  const bottom = lower ?? upper;
  if (top == null && bottom == null) return "unknown";
  if ((top ?? 0) < REACH_NARROW) return "narrow";
  if ((bottom ?? 0) > REACH_BROAD) return "broad";
  return "ok";
}

const MAX_INTERESTS = 6;   // Meta delivers fine well below this; keeps the audience coherent

// ── Pre-plan grounding ────────────────────────────────────────────────────────
export interface PreGrounding {
  pastWins: string;                                             // prompt-ready summary of what worked (may be "")
  customAudiences: { id: string; name: string; count: number | null }[];
}

const fmtInt = (n: number) => n.toLocaleString("en-US");

// Summarise the account's recent winners + list its saved audiences, so the
// copywriter can echo what worked and suggest retargeting an existing audience.
export async function gatherGrounding(
  accountId: string | null,
  deps: GroundingDeps = realDeps,
): Promise<PreGrounding> {
  if (!accountId) return { pastWins: "", customAudiences: [] };
  const [camps, cas] = await Promise.all([
    deps.listAdCampaigns(accountId, "last_30d").catch(() => ({ ok: false, campaigns: [] as Awaited<ReturnType<typeof listAdCampaigns>>["campaigns"] })),
    deps.listCustomAudiences(accountId).catch(() => [] as Awaited<ReturnType<typeof listCustomAudiences>>),
  ]);

  let pastWins = "";
  if (camps.ok && camps.campaigns.length) {
    const winners = camps.campaigns
      .filter(c => c.spend > 0 && (c.results > 0 || c.ctr > 0))
      .sort((a, b) => (b.results - a.results) || (b.ctr - a.ctr))
      .slice(0, 3)
      .map(c => `"${c.name}" — ${c.results} ${c.resultLabel || "results"}, CTR ${c.ctr.toFixed(2)}%`);
    if (winners.length) pastWins = `What performed in the last 30 days: ${winners.join("; ")}.`;
  }
  return { pastWins, customAudiences: cas.slice(0, 12) };
}

// ── Post-plan validation loop ───────────────────────────────────────────────
// The audience the model proposed for one ad set (before any Meta lookup).
export interface AdSetAudience {
  ageMin: number;
  ageMax: number;
  genders: number[];
  interestKeywords: string[];   // free-text interests from the model, e.g. ["Yoga", "Wellness"]
}

// What Meta actually said about that audience.
export interface GroundedAudience {
  interests: { id: string; name: string }[];   // resolved to real Meta interest IDs
  unresolved: string[];                         // keywords Meta had no interest for
  reachLower?: number;
  reachUpper?: number;
  reachStatus: ReachStatus;
}

// Estimate needs the campaign's destination so Meta picks the right optimisation.
export interface EstimateCtx {
  accountId: string;
  countries: string[];
  conversionLocation: "WHATSAPP" | "MESSENGER" | "WEBSITE";
  objective: AdObjective;
  optimizationGoal?: string;
  pageId?: string;
  websiteUrl?: string;
}

// Resolve free-text interest keywords → real Meta interest {id,name}, deduped.
async function resolveInterests(
  keywords: string[],
  deps: GroundingDeps,
): Promise<{ interests: { id: string; name: string }[]; unresolved: string[] }> {
  const interests: { id: string; name: string }[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const kw of keywords.map(k => k.trim()).filter(Boolean)) {
    if (interests.length >= MAX_INTERESTS) break;
    let hits: Awaited<ReturnType<typeof searchTargeting>> = [];
    try { hits = await deps.searchTargeting("interest", kw); } catch { hits = []; }
    // Prefer an exact (case-insensitive) name match, else the top suggestion.
    const best = hits.find(h => h.name.toLowerCase() === kw.toLowerCase()) ?? hits[0];
    if (best && !seen.has(best.key)) {
      seen.add(best.key);
      interests.push({ id: best.key, name: best.name });
    } else if (!best) {
      unresolved.push(kw);
    }
  }
  return { interests, unresolved };
}

async function estimateReach(
  interests: { id: string; name: string }[],
  a: AdSetAudience,
  ctx: EstimateCtx,
  deps: GroundingDeps,
): Promise<{ lower?: number; upper?: number }> {
  try {
    const r = await deps.estimateAudience({
      accountId: ctx.accountId,
      conversionLocation: ctx.conversionLocation,
      objective: ctx.objective,
      optimizationGoal: ctx.optimizationGoal,
      pageId: ctx.pageId ?? "",
      websiteUrl: ctx.websiteUrl,
      placements: "advantage",
      publisherPlatforms: [],
      targeting: {
        countries: ctx.countries.length ? ctx.countries : ["IN"],
        cities: [], regions: [],
        ageMin: a.ageMin, ageMax: a.ageMax, genders: a.genders,
        interests, locales: [],
        customAudiences: [], excludedCustomAudiences: [],
        advantageAudience: false,
      },
    });
    return r.ok ? { lower: r.lower, upper: r.upper } : {};
  } catch { return {}; }
}

// Validate + estimate ONE ad set's audience.
export async function groundAudience(
  a: AdSetAudience,
  ctx: EstimateCtx,
  deps: GroundingDeps = realDeps,
): Promise<GroundedAudience> {
  const { interests, unresolved } = await resolveInterests(a.interestKeywords, deps);
  const { lower, upper } = await estimateReach(interests, a, ctx, deps);
  return { interests, unresolved, reachLower: lower, reachUpper: upper, reachStatus: reachStatusOf(lower, upper) };
}

// A flagged ad set the model is asked to broaden, with why it was flagged.
export interface FlaggedAdSet {
  index: number;
  reachStatus: ReachStatus;
  reachUpper?: number;
  tried: string[];       // interest keywords already attempted (don't repeat these)
}
// reask returns replacement interest keywords per flagged ad-set index.
export type Reask = (flagged: FlaggedAdSet[]) => Promise<Record<number, string[]>>;

const needsBroadening = (g: GroundedAudience) =>
  g.reachStatus === "narrow" || g.interests.length === 0;

// Validate every ad set, then — if any audience came back too narrow or had no
// resolvable interests and a `reask` is provided — let the model propose new
// interests for just those, and re-validate them ONCE. Returns one
// GroundedAudience per input ad set, in order.
export async function groundAdSets(
  audiences: AdSetAudience[],
  ctx: EstimateCtx,
  reask: Reask | null,
  deps: GroundingDeps = realDeps,
): Promise<GroundedAudience[]> {
  const grounded = await Promise.all(audiences.map(a => groundAudience(a, ctx, deps)));

  const flagged: FlaggedAdSet[] = grounded
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => needsBroadening(g))
    .map(({ g, index }) => ({ index, reachStatus: g.reachStatus, reachUpper: g.reachUpper, tried: audiences[index].interestKeywords }));

  if (!reask || !flagged.length) return grounded;

  let replacements: Record<number, string[]> = {};
  try { replacements = await reask(flagged); } catch { replacements = {}; }

  await Promise.all(flagged.map(async ({ index }) => {
    const fresh = replacements[index];
    if (!Array.isArray(fresh) || !fresh.length) return;
    const retry = await groundAudience({ ...audiences[index], interestKeywords: fresh }, ctx, deps);
    // Keep the retry only if it's genuinely better (more resolved interests or a
    // wider — no longer "narrow" — audience); otherwise keep the first attempt.
    const prev = grounded[index];
    const better = retry.interests.length > prev.interests.length ||
      (prev.reachStatus === "narrow" && retry.reachStatus !== "narrow" && retry.interests.length > 0);
    if (better) grounded[index] = retry;
  }));

  return grounded;
}

// One-line human note for a grounded audience — reused by the API + the UI.
export function reachNote(g: GroundedAudience): string {
  if (g.reachStatus === "unknown") return "Reach estimate unavailable.";
  const range = g.reachLower != null && g.reachUpper != null
    ? `${fmtInt(g.reachLower)}–${fmtInt(g.reachUpper)}`
    : g.reachUpper != null ? `~${fmtInt(g.reachUpper)}` : g.reachLower != null ? `~${fmtInt(g.reachLower)}` : "?";
  if (g.reachStatus === "narrow") return `Estimated reach ${range} — narrow; consider broadening.`;
  if (g.reachStatus === "broad") return `Estimated reach ${range} — very broad; consider tightening.`;
  return `Estimated reach ${range}.`;
}
