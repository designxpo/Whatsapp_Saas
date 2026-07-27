// AI Meta-ads planner. Turns a short business brief (budget + a few basics) into
// a complete, launch-ready Click-to-WhatsApp / Messenger / website campaign plan:
// objective, budget split, audience, and ready-to-run ad copy. The plan maps 1:1
// onto CtwaInput, so the existing createCtwaCampaign engine publishes it as-is
// once the client approves — this module only DRAFTS, it never touches Meta.

import { runChat } from "./ai/chat";
import { resolveTenantAi } from "./ai/keys";
import { resolveAgent } from "./aihub";
import { DEFAULT_TENANT_ID } from "./tenant";
import type { AdObjective } from "./ads";
import { getAdsAccountId, getAdsPageId } from "./ads";
import { gatherGrounding, groundAdSets, reachNote, type EstimateCtx, type ReachStatus, type FlaggedAdSet, type AdSetAudience } from "./adgrounding";

export type AdGoal = "WHATSAPP" | "MESSENGER" | "WEBSITE";

export interface AdBrief {
  goal: AdGoal;
  websiteUrl?: string;        // required when goal === WEBSITE
  product: string;            // what they're advertising / the offer
  budgetTotal?: number;       // major units, the client's TOTAL spend (omit if dailyBudget is given)
  dailyBudget?: number;       // major units, per-DAY spend (alternative to budgetTotal)
  ongoing?: boolean;          // campaign runs continuously with no end date
  days?: number;              // how many days to run (omit when ongoing)
  currency: string;           // account currency (for prompt context only)
  countries: string[];        // ISO codes to target (geo picked in the form)
  audienceNote?: string;      // optional free-text targeting hint
  businessName?: string;
  variants?: number;          // how many ad sets (distinct audiences) to test, 1-4
  creativeFormat?: CreativeFormat;   // desired creative type (from the doc/chat); default single
  brief?: string;             // a longer prepared brief (e.g. read from an uploaded document)
}

export type CreativeFormat = "single" | "carousel" | "video";

// One ad set = one audience segment + its own tailored ad copy. Several ad sets
// live under ONE campaign; the campaign's CBO budget is shared across them and
// Meta shifts spend to the best performer.
export interface AdSetPlan {
  audienceLabel: string;            // human label, e.g. "Young professionals 25-34"
  ageMin: number;
  ageMax: number;
  genders: number[];                // [] all, [1] men, [2] women
  primaryText: string;
  headline: string;
  description: string;
  interestKeywords: string[];                         // interests the model proposed (pre-validation)
  interests?: { id: string; name: string }[];         // resolved to real Meta interest IDs (when an account is connected)
  reachLower?: number;                                 // Meta's estimated audience size (lower bound)
  reachUpper?: number;
  reachStatus?: ReachStatus;                           // ok | narrow | broad | unknown
  reachNote?: string;                                  // one-line human summary of the reach
}

export interface AdPlan {
  campaignName: string;
  objective: AdObjective;
  conversionLocation: AdGoal;
  optimizationGoal?: string;
  ctaType?: string;                 // WEBSITE only
  dailyBudget: number;              // major units, the CAMPAIGN (CBO) budget shared across ad sets
  days: number;                     // nominal run length; when ongoing this is just the estimate window
  ongoing: boolean;                 // true = runs continuously with no end date
  budgetTotal: number;              // dailyBudget × days (a projection when ongoing)
  currency: string;
  countries: string[];
  adSets: AdSetPlan[];              // one or more audiences, each with its own copy
  creativeFormat: CreativeFormat;   // single image / carousel / video (reel)
  cards: { headline: string; description: string }[];   // carousel card copy (images uploaded on review); [] otherwise
  rationale: string;                // one-paragraph "why this plan"
  tips: string[];                   // 2-4 short pointers for the client
  suggestedAudiences?: { id: string; name: string; count: number | null }[];  // saved audiences worth retargeting
  grounded?: boolean;               // true when live Meta account data (interests/reach/history) backed this plan
}

// Goal → Meta objective + ad-set destination + (website) optimisation goal.
// Kept in CODE, not left to the model — these must be valid Meta enums.
function resolveGoal(goal: AdGoal): { objective: AdObjective; conversionLocation: AdGoal; optimizationGoal?: string; ctaType?: string } {
  switch (goal) {
    case "WEBSITE":   return { objective: "OUTCOME_TRAFFIC", conversionLocation: "WEBSITE", optimizationGoal: "LANDING_PAGE_VIEWS", ctaType: "LEARN_MORE" };
    case "MESSENGER": return { objective: "OUTCOME_ENGAGEMENT", conversionLocation: "MESSENGER" };
    default:          return { objective: "OUTCOME_ENGAGEMENT", conversionLocation: "WHATSAPP" };
  }
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function mapGenders(v: unknown): number[] {
  const s = String(v ?? "all").toLowerCase();
  if (s.includes("men") && !s.includes("women")) return [1];
  if (s.includes("women")) return [2];
  return [];   // all / everyone / mixed
}

// Draft a campaign from a brief. Never throws for content reasons — falls back to
// sensible copy so the client always gets an editable plan. Throws only when the
// tenant has no AI key (AiKeyMissingError) so the caller can prompt for one.
// Coerce one raw ad-set object → a valid AdSetPlan (clamped, with fallbacks).
function toAdSet(raw: unknown, fallbackCopy: { primaryText: string; headline: string }, idx: number): AdSetPlan {
  const p = (raw ?? {}) as Record<string, unknown>;
  const ageMin = clampInt(p.ageMin, 18, 65, 18);
  return {
    audienceLabel: str(p.audienceLabel, 60) || `Audience ${idx + 1}`,
    ageMin,
    ageMax: Math.max(ageMin, clampInt(p.ageMax, 18, 65, 65)),
    genders: mapGenders(p.genders),
    primaryText: str(p.primaryText, 2000) || fallbackCopy.primaryText,
    headline: str(p.headline, 40) || fallbackCopy.headline,
    description: str(p.description, 60),
    interestKeywords: toKeywords(p.interests),
  };
}

// The model returns interests as a plain string array (["Yoga", "Wellness"]).
const toKeywords = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map(x => String(x).trim()).filter(Boolean))).slice(0, 6) : [];

export async function planAdCampaign(brief: AdBrief, tenantId: string = DEFAULT_TENANT_ID): Promise<AdPlan> {
  const goal = resolveGoal(brief.goal);
  // Budget can be expressed as a total-over-N-days OR a per-day amount, and the
  // campaign may be ongoing (no end date). We always publish a daily budget, so
  // `days` is only used to derive the daily amount + frame the reach/estimate;
  // for ongoing campaigns it's a nominal window.
  const ongoing = !!brief.ongoing;
  const days = clampInt(brief.days, 1, 365, ongoing ? 30 : 7);
  let dailyBudget: number, budgetTotal: number;
  if (Number(brief.dailyBudget) > 0) {
    dailyBudget = Math.max(1, Math.round(Number(brief.dailyBudget)));
    budgetTotal = dailyBudget * days;
  } else {
    budgetTotal = Math.max(1, Math.round(Number(brief.budgetTotal) || 0));
    dailyBudget = Math.max(1, Math.round(budgetTotal / days));
  }
  const variants = clampInt(brief.variants, 1, 10, 1);
  const countries = brief.countries.length ? brief.countries : ["IN"];
  const creativeFormat: CreativeFormat = (["single", "carousel", "video"] as const).includes(brief.creativeFormat as CreativeFormat) ? brief.creativeFormat as CreativeFormat : "single";

  // Light business grounding — the active agent's product info sharpens the copy.
  const agent = await resolveAgent(null, tenantId).catch(() => null);
  const businessBits = [brief.businessName && `Business: ${brief.businessName}`, agent?.productInfo?.trim() && `About the business: ${agent.productInfo.trim().slice(0, 800)}`].filter(Boolean).join("\n");

  // Live Meta grounding — the connected ad account (if any) lets us feed real
  // past performance + saved audiences into the prompt, and later validate the
  // drafted audiences against Meta's actual interest catalogue + reach.
  const accountId = await getAdsAccountId(tenantId).catch(() => "");
  const pageId = accountId ? await getAdsPageId(tenantId).catch(() => "") : "";
  const pre = accountId ? await gatherGrounding(accountId).catch(() => ({ pastWins: "", customAudiences: [] as { id: string; name: string; count: number | null }[] })) : { pastWins: "", customAudiences: [] };
  const audienceLine = pre.customAudiences.length
    ? `This account has these saved/custom audiences you MAY recommend retargeting in a tip (do not invent others): ${pre.customAudiences.map(a => a.name).slice(0, 8).join(", ")}.`
    : "";

  const destLabel = brief.goal === "WEBSITE" ? `drive visits to ${brief.websiteUrl || "the website"}`
    : brief.goal === "MESSENGER" ? "start Facebook Messenger chats" : "start WhatsApp chats";

  const setsAsk = variants > 1
    ? `Design ${variants} DISTINCT ad sets, each aimed at a DIFFERENT audience segment (e.g. different age bands, genders, or buyer mindsets) with copy TAILORED to that segment — this is an audience A/B test under one campaign.`
    : `Design ONE ad set with a sensible audience and copy.`;

  const carouselAsk = creativeFormat === "carousel"
    ? `The creative is a CAROUSEL — also return "cards": 3 cards, each { "headline" (≤ 32 chars), "description" (≤ 20 chars) }, one per product/benefit. The client will add a card image to each.`
    : creativeFormat === "video"
    ? `The creative is a VIDEO/REEL — the client uploads the video; write copy that suits a short video ad.`
    : `The creative is a SINGLE IMAGE.`;

  const instruction = [
    `Write high-converting Meta (Facebook/Instagram) ads for this business. The goal is to ${destLabel}.`,
    businessBits,
    `What they're advertising: ${brief.product}`,
    brief.brief ? `The client's prepared brief (use it as the source of truth for structure, offer, audience, and tone):\n"""\n${brief.brief.slice(0, 6000)}\n"""` : "",
    ongoing
      ? `Budget: ${brief.currency} ${dailyBudget}/day, running continuously with no end date (shared across all ad sets). Target countries: ${countries.join(", ")}.`
      : `Total budget: ${brief.currency} ${budgetTotal} over ${days} day(s) (shared across all ad sets). Target countries: ${countries.join(", ")}.`,
    brief.audienceNote ? `Audience hint from the client: ${brief.audienceNote}` : "",
    pre.pastWins ? `Account history — lean into what already worked: ${pre.pastWins}` : "",
    audienceLine,
    "",
    setsAsk,
    carouselAsk,
    "Rules for every ad set:",
    "- Ground the copy in what they're advertising. Do NOT invent prices, discounts, guarantees, or claims the brief doesn't support.",
    "- primaryText: the main ad text, punchy and benefit-led, ≤ 125 characters, may use 1 emoji.",
    "- headline: ≤ 40 characters. description: ≤ 30 characters.",
    "- audienceLabel: a short human label for who this ad set targets.",
    "- ageMin/ageMax: 18–65. genders: one of \"all\" | \"men\" | \"women\".",
    "- interests: an array of 3–5 REAL Facebook/Instagram interest or behaviour names that plausibly exist in Meta's targeting catalogue (e.g. \"Yoga\", \"Organic food\", \"Small business owners\"). Pick interests broad enough to reach tens of thousands of people — avoid hyper-specific phrases Meta won't recognise.",
    "- When testing multiple ad sets, make the segments genuinely different (don't repeat the same audience/copy/interests).",
    "campaignName: short and internal (e.g. \"Diwali Sale — WhatsApp\"). rationale: ONE short paragraph in plain language. tips: 2–4 short concrete pointers.",
    `Return ONLY JSON: {"campaignName","rationale","tips":[],"adSets":[{"audienceLabel","ageMin","ageMax","genders","interests":[],"primaryText","headline","description"}]${creativeFormat === "carousel" ? ',"cards":[{"headline","description"}]' : ""}} with exactly ${variants} ad set(s).`,
  ].filter(Boolean).join("\n");

  const baseCopy = { primaryText: `${brief.product}`.slice(0, 125) || "Message us to learn more!", headline: "Learn more" };
  const fallback = (): AdPlan => ({
    campaignName: `${brief.product.slice(0, 30) || "New campaign"} — ${brief.goal === "WEBSITE" ? "Traffic" : "Chats"}`,
    objective: goal.objective, conversionLocation: goal.conversionLocation, optimizationGoal: goal.optimizationGoal, ctaType: goal.ctaType,
    dailyBudget, days, ongoing, budgetTotal, currency: brief.currency, countries,
    adSets: Array.from({ length: variants }, (_, i) => ({
      audienceLabel: variants > 1 ? `Audience ${i + 1}` : "Everyone",
      ageMin: 18, ageMax: 65, genders: [], primaryText: baseCopy.primaryText, headline: baseCopy.headline, description: "", interestKeywords: [],
    })),
    creativeFormat,
    cards: creativeFormat === "carousel" ? [{ headline: "Card 1", description: "" }, { headline: "Card 2", description: "" }, { headline: "Card 3", description: "" }] : [],
    rationale: `Runs a ${brief.goal === "WEBSITE" ? "traffic" : "conversation"} ${creativeFormat} campaign at ${brief.currency} ${dailyBudget}/day for ${days} day(s) across ${variants} ad set(s), targeting ${countries[0]}.`,
    tips: ["Reply to new chats fast — speed wins deals.", "Add a clear offer or reason to message now."],
  });

  let ai;
  try { ai = await resolveTenantAi(tenantId, agent?.model ?? null); }
  catch { return fallback(); }   // no key → still return an editable draft

  try {
    const res = await runChat({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
      system: "You are a senior performance-marketing strategist. You output ONLY valid JSON — no markdown fences, no preamble.",
      turns: [{ role: "user", text: instruction }],
      maxTokens: Math.min(4000, 700 + variants * 450),   // scale headroom with ad-set count
    });
    const raw = (res.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
    const p = JSON.parse(raw) as Record<string, unknown>;
    const f = fallback();
    const rawSets = Array.isArray(p.adSets) && p.adSets.length ? p.adSets.slice(0, variants) : [];
    let adSets = rawSets.map((s, i) => toAdSet(s, baseCopy, i));
    while (adSets.length < variants) adSets = [...adSets, f.adSets[adSets.length]];   // pad if the model returned too few
    const rawCards = creativeFormat === "carousel" && Array.isArray(p.cards) ? p.cards : [];
    const cards = rawCards.length >= 2
      ? rawCards.slice(0, 10).map((c, i) => ({ headline: str((c as Record<string, unknown>)?.headline, 32) || `Card ${i + 1}`, description: str((c as Record<string, unknown>)?.description, 20) }))
      : f.cards;

    // Validate the drafted audiences against Meta's real interest catalogue +
    // reach, and let the model broaden any that come back too narrow (one pass).
    // Best-effort — if no account is connected or Meta errors, adSets pass through.
    adSets = await groundPlanAudiences(adSets, {
      ai, accountId, pageId, countries,
      conversionLocation: goal.conversionLocation, objective: goal.objective, optimizationGoal: goal.optimizationGoal,
      websiteUrl: brief.websiteUrl,
    });

    return {
      campaignName: str(p.campaignName, 120) || f.campaignName,
      objective: goal.objective, conversionLocation: goal.conversionLocation, optimizationGoal: goal.optimizationGoal, ctaType: goal.ctaType,
      dailyBudget, days, ongoing, budgetTotal, currency: brief.currency, countries,
      adSets,
      creativeFormat, cards,
      rationale: str(p.rationale, 600) || f.rationale,
      tips: Array.isArray(p.tips) ? p.tips.map(t => String(t).trim()).filter(Boolean).slice(0, 4) : f.tips,
      suggestedAudiences: pre.customAudiences.length ? pre.customAudiences : undefined,
      grounded: !!accountId,
    };
  } catch {
    return fallback();
  }
}

// Validate + reach-check the drafted audiences against the connected Meta account
// and broaden any that came back too narrow (one model pass). Returns the ad sets
// enriched with resolved interests + a reach estimate. No account → unchanged.
async function groundPlanAudiences(
  adSets: AdSetPlan[],
  ctx: {
    ai: Awaited<ReturnType<typeof resolveTenantAi>>;
    accountId: string;
    pageId: string;
    countries: string[];
    conversionLocation: EstimateCtx["conversionLocation"];
    objective: AdObjective;
    optimizationGoal?: string;
    websiteUrl?: string;
  },
): Promise<AdSetPlan[]> {
  if (!ctx.accountId) return adSets;
  const estimateCtx: EstimateCtx = {
    accountId: ctx.accountId, countries: ctx.countries,
    conversionLocation: ctx.conversionLocation, objective: ctx.objective,
    optimizationGoal: ctx.optimizationGoal, pageId: ctx.pageId, websiteUrl: ctx.websiteUrl,
  };
  const audiences: AdSetAudience[] = adSets.map(s => ({
    ageMin: s.ageMin, ageMax: s.ageMax, genders: s.genders, interestKeywords: s.interestKeywords,
  }));

  // One refine pass: ask the model for broader, real interests for flagged sets.
  const reask = async (flagged: FlaggedAdSet[]): Promise<Record<number, string[]>> => {
    const lines = flagged.map(fl => `Ad set #${fl.index} (targets "${adSets[fl.index]?.audienceLabel ?? ""}") — reach came back ${fl.reachStatus}${fl.reachUpper != null ? ` (~${fl.reachUpper.toLocaleString("en-US")} people)` : ""}. Already tried: ${fl.tried.join(", ") || "none"}.`);
    try {
      const r = await runChat({
        provider: ctx.ai.provider, apiKey: ctx.ai.apiKey, model: ctx.ai.model,
        system: "You fix Meta ad targeting. Reply ONLY with JSON mapping each ad-set index to an array of 3–5 BROADER, definitely-real Facebook/Instagram interest names that will reach more people. No prose, no markdown fences.",
        turns: [{ role: "user", text: `These ad sets reached too few people. Suggest broader, real Meta interests for each (do NOT repeat the ones already tried):\n${lines.join("\n")}\n\nReturn JSON like {"0":["Fitness","Health and wellness"],"2":["Online shopping"]}.` }],
        maxTokens: 500,
      });
      const raw = (r.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<number, string[]> = {};
      for (const [k, v] of Object.entries(obj)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && Array.isArray(v)) out[idx] = v.map(x => String(x).trim()).filter(Boolean).slice(0, 5);
      }
      return out;
    } catch { return {}; }
  };

  let grounded;
  try { grounded = await groundAdSets(audiences, estimateCtx, reask); }
  catch { return adSets; }   // any Meta/parse failure → keep the un-grounded draft

  return adSets.map((s, i) => {
    const g = grounded[i];
    if (!g) return s;
    return { ...s, interests: g.interests, reachLower: g.reachLower, reachUpper: g.reachUpper, reachStatus: g.reachStatus, reachNote: reachNote(g) };
  });
}
