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

export type AdGoal = "WHATSAPP" | "MESSENGER" | "WEBSITE";

export interface AdBrief {
  goal: AdGoal;
  websiteUrl?: string;        // required when goal === WEBSITE
  product: string;            // what they're advertising / the offer
  budgetTotal: number;        // major units, the client's total spend
  days: number;               // how many days to run
  currency: string;           // account currency (for prompt context only)
  countries: string[];        // ISO codes to target (geo picked in the form)
  audienceNote?: string;      // optional free-text targeting hint
  businessName?: string;
}

export interface AdPlan {
  campaignName: string;
  objective: AdObjective;
  conversionLocation: AdGoal;
  optimizationGoal?: string;
  ctaType?: string;                 // WEBSITE only
  dailyBudget: number;              // major units (budgetTotal / days, floored)
  days: number;
  budgetTotal: number;
  currency: string;
  ageMin: number;
  ageMax: number;
  genders: number[];                // [] all, [1] men, [2] women
  countries: string[];
  primaryText: string;
  headline: string;
  description: string;
  rationale: string;                // one-paragraph "why this plan"
  tips: string[];                   // 2-4 short pointers for the client
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
export async function planAdCampaign(brief: AdBrief, tenantId: string = DEFAULT_TENANT_ID): Promise<AdPlan> {
  const goal = resolveGoal(brief.goal);
  const days = clampInt(brief.days, 1, 365, 7);
  const budgetTotal = Math.max(1, Math.round(brief.budgetTotal));
  const dailyBudget = Math.max(1, Math.round(budgetTotal / days));

  // Light business grounding — the active agent's product info sharpens the copy.
  const agent = await resolveAgent(null, tenantId).catch(() => null);
  const businessBits = [brief.businessName && `Business: ${brief.businessName}`, agent?.productInfo?.trim() && `About the business: ${agent.productInfo.trim().slice(0, 800)}`].filter(Boolean).join("\n");

  const destLabel = brief.goal === "WEBSITE" ? `drive visits to ${brief.websiteUrl || "the website"}`
    : brief.goal === "MESSENGER" ? "start Facebook Messenger chats" : "start WhatsApp chats";

  const instruction = [
    `Write a high-converting Meta (Facebook/Instagram) ad for this business. The ad's goal is to ${destLabel}.`,
    businessBits,
    `What they're advertising: ${brief.product}`,
    `Total budget: ${brief.currency} ${budgetTotal} over ${days} day(s). Target countries: ${brief.countries.join(", ") || "IN"}.`,
    brief.audienceNote ? `Audience hint from the client: ${brief.audienceNote}` : "",
    "",
    "Rules:",
    "- Ground the copy in what they're advertising. Do NOT invent prices, discounts, guarantees, or claims the brief doesn't support.",
    "- primaryText: the main ad text, punchy and benefit-led, ≤ 125 characters, may use 1 emoji.",
    "- headline: ≤ 40 characters. description: ≤ 30 characters (a short supporting line).",
    "- Suggest a sensible audience: an age range (18–65) and gender (men / women / all) that fits the product; default to all when unsure.",
    "- campaignName: short and internal (e.g. \"Diwali Sale — WhatsApp\").",
    "- rationale: ONE short paragraph explaining the plan to the client in plain language.",
    "- tips: 2–4 very short, concrete pointers (e.g. reply fast, add an offer).",
    `Return ONLY JSON: {"campaignName","primaryText","headline","description","ageMin","ageMax","genders","rationale","tips":[]} — "genders" is one of "all" | "men" | "women".`,
  ].filter(Boolean).join("\n");

  const fallback = (): AdPlan => ({
    campaignName: `${brief.product.slice(0, 30) || "New campaign"} — ${brief.goal === "WEBSITE" ? "Traffic" : "Chats"}`,
    objective: goal.objective, conversionLocation: goal.conversionLocation, optimizationGoal: goal.optimizationGoal, ctaType: goal.ctaType,
    dailyBudget, days, budgetTotal, currency: brief.currency,
    ageMin: 18, ageMax: 65, genders: [], countries: brief.countries.length ? brief.countries : ["IN"],
    primaryText: `${brief.product}`.slice(0, 125) || "Message us to learn more!",
    headline: "Learn more".slice(0, 40), description: "",
    rationale: `Runs a ${brief.goal === "WEBSITE" ? "traffic" : "conversation"} campaign at ${brief.currency} ${dailyBudget}/day for ${days} day(s), targeting ${(brief.countries[0] ?? "IN")}.`,
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
      maxTokens: 900,
    });
    const raw = (res.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
    const p = JSON.parse(raw) as Record<string, unknown>;
    const f = fallback();
    const ageMin = clampInt(p.ageMin, 18, 65, 18);
    return {
      campaignName: str(p.campaignName, 120) || f.campaignName,
      objective: goal.objective, conversionLocation: goal.conversionLocation, optimizationGoal: goal.optimizationGoal, ctaType: goal.ctaType,
      dailyBudget, days, budgetTotal, currency: brief.currency,
      ageMin,
      ageMax: Math.max(ageMin, clampInt(p.ageMax, 18, 65, 65)),
      genders: mapGenders(p.genders),
      countries: brief.countries.length ? brief.countries : ["IN"],
      primaryText: str(p.primaryText, 2000) || f.primaryText,
      headline: str(p.headline, 40) || f.headline,
      description: str(p.description, 60),
      rationale: str(p.rationale, 600) || f.rationale,
      tips: Array.isArray(p.tips) ? p.tips.map(t => String(t).trim()).filter(Boolean).slice(0, 4) : f.tips,
    };
  } catch {
    return fallback();
  }
}
