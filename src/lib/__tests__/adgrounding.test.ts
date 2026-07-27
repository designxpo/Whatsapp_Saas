import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the Meta Graph layer + the AI layer so nothing hits the network. ─────
const ads = vi.hoisted(() => ({
  getAdsAccountId: vi.fn(),
  getAdsPageId: vi.fn(),
  searchTargeting: vi.fn(),
  estimateAudience: vi.fn(),
  listCustomAudiences: vi.fn(),
  listAdCampaigns: vi.fn(),
}));
const ai = vi.hoisted(() => ({ runChat: vi.fn(), resolveTenantAi: vi.fn(), resolveAgent: vi.fn() }));

vi.mock("../ads", () => ads);
vi.mock("../ai/chat", () => ({ runChat: ai.runChat }));
vi.mock("../ai/keys", () => ({ resolveTenantAi: ai.resolveTenantAi, AiKeyMissingError: class AiKeyMissingError extends Error {} }));
vi.mock("../aihub", () => ({ resolveAgent: ai.resolveAgent }));

import {
  reachStatusOf, reachNote, groundAudience, groundAdSets, gatherGrounding,
  REACH_NARROW, REACH_BROAD, type GroundingDeps, type EstimateCtx, type AdSetAudience, type FlaggedAdSet,
} from "../adgrounding";
import { planAdCampaign } from "../adplanner";

// A fake Meta interest catalogue + reach oracle, driven by keyword.
const CATALOGUE: Record<string, { key: string; audience: number }> = {
  "Tiny Niche":    { key: "i_tiny",  audience: 30_000 },
  "Fitness":       { key: "i_fit",   audience: 900_000 },
  "Broad Health":  { key: "i_broad", audience: 2_000_000 },
  "Yoga":          { key: "i_yoga",  audience: 400_000 },
};
const BIG_IDS = new Set(["i_fit", "i_broad", "i_yoga"]);   // ids that estimate as a healthy audience

function makeDeps(over: Partial<GroundingDeps> = {}): GroundingDeps {
  return {
    searchTargeting: vi.fn(async (kind: string, q: string) => {
      if (kind !== "interest") return [];
      const hit = CATALOGUE[q];
      return hit ? [{ key: hit.key, name: q, type: "interests", audience: hit.audience }] : [];
    }),
    estimateAudience: vi.fn(async (input: { targeting: { interests: { id: string }[] } }) => {
      const big = input.targeting.interests.some(i => BIG_IDS.has(i.id));
      const base = big ? 400_000 : 12_000;
      return { ok: true, lower: base, upper: base * 2, ready: true };
    }),
    listCustomAudiences: vi.fn(async () => []),
    listAdCampaigns: vi.fn(async () => ({ ok: true, campaigns: [] })),
    ...over,
  } as unknown as GroundingDeps;
}

const CTX: EstimateCtx = { accountId: "act1", countries: ["IN"], conversionLocation: "WHATSAPP", objective: "OUTCOME_ENGAGEMENT" as EstimateCtx["objective"] };
const aud = (interestKeywords: string[], over: Partial<AdSetAudience> = {}): AdSetAudience => ({ ageMin: 18, ageMax: 65, genders: [], interestKeywords, ...over });

beforeEach(() => {
  for (const f of Object.values(ads)) f.mockReset();
  for (const f of Object.values(ai)) f.mockReset();
});

describe("reachStatusOf", () => {
  it("classifies unknown / narrow / ok / broad by the exported thresholds", () => {
    expect(reachStatusOf(undefined, undefined)).toBe("unknown");
    expect(reachStatusOf(REACH_NARROW - 1, REACH_NARROW - 1)).toBe("narrow");
    expect(reachStatusOf(100_000, 500_000)).toBe("ok");
    expect(reachStatusOf(REACH_BROAD + 1, REACH_BROAD + 2)).toBe("broad");
  });
  it("uses the upper bound for the narrow test and lower for the broad test", () => {
    expect(reachStatusOf(10, 100_000)).toBe("ok");           // small lower but healthy upper → not narrow
    expect(reachStatusOf(1_000, REACH_BROAD + 5)).toBe("ok");// huge upper but small lower → not broad
  });
});

describe("groundAudience", () => {
  it("resolves keywords to real interest IDs, prefers exact-name matches, and dedupes", async () => {
    const deps = makeDeps({
      searchTargeting: vi.fn(async (_k: string, q: string) =>
        q === "Yoga" ? [{ key: "i_yoga_deluxe", name: "Yoga Deluxe" }, { key: "i_yoga", name: "Yoga" }] : []),
    });
    const g = await groundAudience(aud(["Yoga", "Yoga"]), CTX, deps);
    expect(g.interests).toEqual([{ id: "i_yoga", name: "Yoga" }]);   // exact "Yoga" beat "Yoga Deluxe"; dupe collapsed
  });

  it("records keywords Meta can't resolve as unresolved", async () => {
    const g = await groundAudience(aud(["Fitness", "Totally Made Up Interest"]), CTX, makeDeps());
    expect(g.interests).toEqual([{ id: "i_fit", name: "Fitness" }]);
    expect(g.unresolved).toEqual(["Totally Made Up Interest"]);
  });

  it("attaches Meta's reach estimate + status", async () => {
    const g = await groundAudience(aud(["Fitness"]), CTX, makeDeps());
    expect(g.reachLower).toBe(400_000);
    expect(g.reachStatus).toBe("ok");
    expect(reachNote(g)).toMatch(/Estimated reach/);
  });

  it("flags a genuinely small audience as narrow", async () => {
    const g = await groundAudience(aud(["Tiny Niche"]), CTX, makeDeps());
    expect(g.reachStatus).toBe("narrow");
    expect(reachNote(g)).toMatch(/narrow/);
  });
});

describe("groundAdSets refine loop", () => {
  it("broadens a narrow ad set via reask and adopts the better result", async () => {
    const deps = makeDeps();
    const reask = vi.fn(async () => ({ 0: ["Broad Health"] }));   // model's broader suggestion for set #0
    const grounded = await groundAdSets([aud(["Tiny Niche"]), aud(["Fitness"])], CTX, reask, deps);

    expect(reask).toHaveBeenCalledTimes(1);
    // set #0 was narrow → refined to the broad interest, now ok
    expect(grounded[0].interests).toEqual([{ id: "i_broad", name: "Broad Health" }]);
    expect(grounded[0].reachStatus).toBe("ok");
    // set #1 was already fine → untouched
    expect(grounded[1].interests).toEqual([{ id: "i_fit", name: "Fitness" }]);
  });

  it("only asks the model to broaden the ad sets that were actually flagged", async () => {
    const reask = vi.fn(async (_flagged: FlaggedAdSet[]) => ({} as Record<number, string[]>));
    await groundAdSets([aud(["Fitness"]), aud(["Tiny Niche"]), aud(["Yoga"])], CTX, reask, makeDeps());
    const flagged = reask.mock.calls[0][0];
    expect(flagged.map(f => f.index)).toEqual([1]);   // only the "Tiny Niche" set
  });

  it("keeps the first attempt when the reask isn't actually better", async () => {
    const reask = vi.fn(async () => ({ 0: ["Tiny Niche"] }));   // still narrow, no improvement
    const grounded = await groundAdSets([aud(["Tiny Niche"])], CTX, reask, makeDeps());
    expect(grounded[0].interests).toEqual([{ id: "i_tiny", name: "Tiny Niche" }]);
    expect(grounded[0].reachStatus).toBe("narrow");
  });

  it("skips the reask entirely when every audience is healthy", async () => {
    const reask = vi.fn(async () => ({}));
    await groundAdSets([aud(["Fitness"]), aud(["Yoga"])], CTX, reask, makeDeps());
    expect(reask).not.toHaveBeenCalled();
  });
});

describe("gatherGrounding", () => {
  it("summarises the account's recent winners and returns its saved audiences", async () => {
    const deps = makeDeps({
      listAdCampaigns: vi.fn(async () => ({ ok: true, campaigns: [
        { id: "c1", name: "Diwali WA", spend: 3200, results: 42, resultLabel: "Chats", ctr: 1.8, impressions: 1, clicks: 1, cpc: 1, conversations: 42, objective: "ENGAGEMENT", dailyBudget: null, effectiveStatus: "ACTIVE", delivery: { label: "Active", phase: "active" as const } },
        { id: "c2", name: "Dead Ad",   spend: 0,    results: 0,  resultLabel: "Chats", ctr: 0,   impressions: 0, clicks: 0, cpc: 0, conversations: 0, objective: "ENGAGEMENT", dailyBudget: null, effectiveStatus: "PAUSED", delivery: { label: "Off", phase: "off" as const } },
      ] })),
      listCustomAudiences: vi.fn(async () => [{ id: "ca1", name: "Past buyers", count: 1200 }]),
    });
    const pre = await gatherGrounding("act1", deps);
    expect(pre.pastWins).toContain("Diwali WA");
    expect(pre.pastWins).not.toContain("Dead Ad");     // zero-spend campaign excluded
    expect(pre.customAudiences).toEqual([{ id: "ca1", name: "Past buyers", count: 1200 }]);
  });

  it("no account → empty grounding, no Meta calls", async () => {
    const deps = makeDeps();
    const pre = await gatherGrounding(null, deps);
    expect(pre).toEqual({ pastWins: "", customAudiences: [] });
    expect(deps.listAdCampaigns).not.toHaveBeenCalled();
  });
});

// ── Full end-to-end simulation of the planner with a connected account. ───────
describe("planAdCampaign — end-to-end grounding simulation", () => {
  beforeEach(() => {
    ai.resolveAgent.mockResolvedValue(null);
    ai.resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "k", model: "m" });
    ads.getAdsPageId.mockResolvedValue("page_1");
    ads.searchTargeting.mockImplementation(async (kind: string, q: string) => {
      if (kind !== "interest") return [];
      const hit = CATALOGUE[q];
      return hit ? [{ key: hit.key, name: q, type: "interests", audience: hit.audience }] : [];
    });
    ads.estimateAudience.mockImplementation(async (input: { targeting: { interests: { id: string }[] } }) => {
      const big = input.targeting.interests.some(i => BIG_IDS.has(i.id));
      const base = big ? 400_000 : 12_000;
      return { ok: true, lower: base, upper: base * 2, ready: true };
    });
    ads.listCustomAudiences.mockResolvedValue([{ id: "ca1", name: "Past buyers", count: 1200 }]);
    ads.listAdCampaigns.mockResolvedValue({ ok: true, campaigns: [] });
  });

  const PLAN_JSON = JSON.stringify({
    campaignName: "Sim Campaign",
    rationale: "Test rationale.",
    tips: ["Reply fast."],
    adSets: [
      { audienceLabel: "Niche folks", ageMin: 25, ageMax: 40, genders: "all",   interests: ["Tiny Niche"], primaryText: "Chat with us", headline: "Talk now",  description: "" },
      { audienceLabel: "Fit folks",   ageMin: 18, ageMax: 45, genders: "women", interests: ["Fitness"],    primaryText: "Get fit",      headline: "Start now", description: "" },
    ],
  });

  it("validates interests, estimates reach, and refines the narrow ad set — all from a brief", async () => {
    ads.getAdsAccountId.mockResolvedValue("12345");
    ai.runChat
      .mockResolvedValueOnce({ text: PLAN_JSON, toolCalls: [] })          // 1st: draft the plan
      .mockResolvedValueOnce({ text: '{"0":["Broad Health"]}', toolCalls: [] });  // 2nd: broaden set #0

    const plan = await planAdCampaign({
      goal: "WHATSAPP", product: "Yoga classes", budgetTotal: 7000, days: 7,
      currency: "INR", countries: ["IN"], variants: 2,
    }, "tenant1");

    expect(plan.grounded).toBe(true);
    expect(plan.adSets).toHaveLength(2);

    // set #1 resolved to a real interest with a healthy reach — untouched
    expect(plan.adSets[1].interests).toEqual([{ id: "i_fit", name: "Fitness" }]);
    expect(plan.adSets[1].reachStatus).toBe("ok");

    // set #0 started narrow ("Tiny Niche") and was broadened to "Broad Health"
    expect(plan.adSets[0].interests).toEqual([{ id: "i_broad", name: "Broad Health" }]);
    expect(plan.adSets[0].reachStatus).toBe("ok");
    expect(plan.adSets[0].reachNote).toMatch(/Estimated reach/);

    // saved audience surfaced for retargeting suggestions
    expect(plan.suggestedAudiences).toEqual([{ id: "ca1", name: "Past buyers", count: 1200 }]);

    // exactly two model calls: the draft + one refine pass
    expect(ai.runChat).toHaveBeenCalledTimes(2);
  });

  it("with no connected ad account, skips Meta grounding but still returns a draft", async () => {
    ads.getAdsAccountId.mockResolvedValue("");   // no account
    ai.runChat.mockResolvedValueOnce({ text: PLAN_JSON, toolCalls: [] });

    const plan = await planAdCampaign({
      goal: "WHATSAPP", product: "Yoga classes", budgetTotal: 7000, days: 7,
      currency: "INR", countries: ["IN"], variants: 2,
    }, "tenant1");

    expect(plan.grounded).toBe(false);
    expect(plan.adSets[0].interests).toBeUndefined();        // never validated
    expect(plan.adSets[0].interestKeywords).toEqual(["Tiny Niche"]);  // model's raw proposal preserved
    expect(ads.estimateAudience).not.toHaveBeenCalled();
    expect(ai.runChat).toHaveBeenCalledTimes(1);             // no refine pass
  });

  // Regression: the chat looped forever when a user gave a daily budget + no end
  // date, because the plan only understood total-budget-over-N-days.
  it("accepts a daily budget with no end date (ongoing) — the reported loop", async () => {
    ads.getAdsAccountId.mockResolvedValue("");
    ai.runChat.mockResolvedValueOnce({ text: PLAN_JSON, toolCalls: [] });

    const plan = await planAdCampaign({
      goal: "WEBSITE", product: "online course", dailyBudget: 500, ongoing: true,
      websiteUrl: "https://course.example.com", currency: "INR", countries: ["IN"], variants: 1,
    }, "tenant1");

    expect(plan.dailyBudget).toBe(500);           // used the per-day amount as-is
    expect(plan.ongoing).toBe(true);              // marked continuous
    expect(plan.days).toBe(30);                   // nominal window for estimate/display
    expect(plan.budgetTotal).toBe(500 * 30);      // projection, not a hard cap
  });

  it("still derives a daily budget from a total + days when given a total", async () => {
    ads.getAdsAccountId.mockResolvedValue("");
    ai.runChat.mockResolvedValueOnce({ text: PLAN_JSON, toolCalls: [] });

    const plan = await planAdCampaign({
      goal: "WHATSAPP", product: "yoga", budgetTotal: 7000, days: 7,
      currency: "INR", countries: ["IN"], variants: 1,
    }, "tenant1");

    expect(plan.dailyBudget).toBe(1000);          // 7000 / 7
    expect(plan.ongoing).toBe(false);
  });
});
