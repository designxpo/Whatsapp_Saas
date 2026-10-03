// The content pipeline's selection logic.
//
// This decides what gets written every night. A scorer that drifts does not
// fail loudly — it quietly produces a month of pages nobody searches for, and
// nobody notices until the traffic does not arrive. So the behaviour is pinned
// rather than trusted.

import { describe, it, expect } from "vitest";
import { cleanTitle, findGaps, isEnglishish, normalizeTopic, penalties, scoreGap, topicSimilarity } from "../contentgaps";

const pages = (competitor: string, ...titles: string[]) =>
  ({ competitor, pages: titles.map((t, i) => ({ url: `https://${competitor}.com/blog/${i}`, title: t })) });

describe("normalizeTopic", () => {
  it("collapses two phrasings of the same topic onto one key", () => {
    // The whole gap analysis rests on this: if these produce different keys,
    // two competitors covering one topic look like two separate topics and
    // neither clears the consensus floor.
    expect(normalizeTopic("WhatsApp Business API Pricing in 2026"))
      .toBe(normalizeTopic("The Complete Guide to WhatsApp Business API Pricing"));
  });

  it("strips competitor brand names so they never become the topic", () => {
    // Every WATI post says "WATI". Left in, the top gap would be "wati".
    expect(normalizeTopic("WATI vs Interakt: Which WhatsApp Tool Wins?")).not.toContain("wati");
    expect(normalizeTopic("How Talko AI Handles Broadcasts")).not.toContain("talko");
  });

  it("drops marketing filler that would otherwise merge unrelated topics", () => {
    expect(normalizeTopic("The Ultimate Guide to Best Free Tools 2026")).toBe("tool");
  });

  it("survives punctuation, casing and empty input", () => {
    expect(normalizeTopic("WhatsApp — Broadcast, Limits & Rules!")).toBe(normalizeTopic("whatsapp broadcast limits rules"));
    expect(normalizeTopic("")).toBe("");
  });
});

describe("topicSimilarity", () => {
  it("scores identical topics 1 and unrelated topics 0", () => {
    expect(topicSimilarity("whatsapp pricing", "whatsapp pricing")).toBe(1);
    expect(topicSimilarity("whatsapp pricing", "instagram reels")).toBe(0);
  });

  it("scores partial overlap between 0 and 1", () => {
    const s = topicSimilarity("whatsapp broadcast limit", "whatsapp broadcast rule");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("findGaps", () => {
  const ours = [{ url: "https://www.thetalko.in/blog/x", title: "Why Your WhatsApp Template Keeps Getting Rejected" }];

  it("surfaces a topic two or more competitors cover and we do not", () => {
    const gaps = findGaps([
      pages("wati", "WhatsApp Green Tick Verification Explained"),
      pages("aisensy", "How to Get the WhatsApp Green Tick"),
    ], ours);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].covered).toEqual(["aisensy", "wati"]);
  });

  it("ignores a topic only one competitor covers", () => {
    // One company writing about something is their guess, not demand.
    expect(findGaps([pages("wati", "WhatsApp Green Tick Verification Explained")], ours)).toEqual([]);
  });

  it("does not report a gap we have already published", () => {
    const gaps = findGaps([
      pages("wati", "Why WhatsApp Templates Get Rejected"),
      pages("aisensy", "WhatsApp Template Rejected: Reasons and Fixes"),
    ], ours);
    expect(gaps.map(g => g.label)).not.toContain("Why WhatsApp Templates Get Rejected");
  });

  it("counts one competitor once however many times they cover a topic", () => {
    // A prolific blog publishing near-duplicates must not look like consensus.
    const gaps = findGaps([
      pages("wati", "WhatsApp Green Tick Guide", "Getting the WhatsApp Green Tick", "WhatsApp Green Tick FAQ"),
    ], ours);
    expect(gaps).toEqual([]);
  });

  it("ranks the better-covered, more relevant topic first", () => {
    const gaps = findGaps([
      pages("wati", "WhatsApp Broadcast Limits Explained", "Email Newsletter Design Tips"),
      pages("aisensy", "Understanding WhatsApp Broadcast Limits", "Email Newsletter Design Ideas"),
      pages("tidio", "WhatsApp Broadcast Limits in 2026"),
    ], ours, { relevanceTerms: ["whatsapp", "broadcast"] });
    expect(gaps[0].label.toLowerCase()).toContain("broadcast");
  });

  it("prefers the least keyword-stuffed phrasing as the label", () => {
    const gaps = findGaps([
      pages("wati", "WhatsApp Green Tick"),
      pages("aisensy", "The Complete Ultimate Guide to WhatsApp Green Tick Verification 2026"),
    ], ours);
    expect(gaps[0].label).toBe("WhatsApp Green Tick");
  });

  it("returns nothing rather than throwing on empty input", () => {
    expect(findGaps([], [])).toEqual([]);
    expect(findGaps([pages("wati")], ours)).toEqual([]);
  });
});

describe("scoreGap", () => {
  it("rewards competitor consensus with diminishing returns", () => {
    const two = scoreGap("whatsapp broadcast limit", "whatsapp broadcast limit", 2, []);
    const three = scoreGap("whatsapp broadcast limit", "whatsapp broadcast limit", 3, []);
    const six = scoreGap("whatsapp broadcast limit", "whatsapp broadcast limit", 6, []);
    expect(three).toBeGreaterThan(two);
    // 2→3 must matter more than 5→6, or a crowded topic always wins.
    expect(three - two).toBeGreaterThan(six - scoreGap("whatsapp broadcast limit", "whatsapp broadcast limit", 5, []));
  });

  it("rewards topics our product actually knows about", () => {
    expect(scoreGap("whatsapp broadcast limit", "whatsapp broadcast limit", 2, ["whatsapp", "broadcast"]))
      .toBeGreaterThan(scoreGap("email newsletter design", "email newsletter design", 2, ["whatsapp", "broadcast"]));
  });

  it("penalises topics too broad or too narrow to win", () => {
    // Two words is a head term a four-month-old domain cannot take.
    const broad = scoreGap("whatsapp marketing", "whatsapp marketing", 3, []);
    const right = scoreGap("whatsapp broadcast limit tier", "whatsapp broadcast limit tier", 3, []);
    expect(right).toBeGreaterThan(broad);
  });
});

// ── Regressions from the first live dry run ─────────────────────────────────
// Neither of these was reachable from invented fixtures. Both came out of
// running the crawler against 359 real competitor pages, and both would have
// shipped a bad topic choice every night.
describe("isEnglishish", () => {
  it("rejects the Chinese title that won the first real dry run", () => {
    // The normaliser strips non-ASCII, so this reduced to "api whatsapp",
    // clustered with English pages, and came out top-ranked.
    expect(isEnglishish("体验新的Wati：您的升级版WhatsApp API服务")).toBe(false);
  });

  it("accepts ordinary English titles, punctuation and all", () => {
    expect(isEnglishish("WhatsApp Business API Pricing in 2026")).toBe(true);
    expect(isEnglishish("Red, Flagged, Restricted — What It Means")).toBe(true);
  });

  it("tolerates a stray accent or symbol in an English title", () => {
    expect(isEnglishish("WhatsApp Pricing in India (₹0.115 per message)")).toBe(true);
    expect(isEnglishish("Café Owners: Automating Orders on WhatsApp")).toBe(true);
  });

  it("rejects a title with no letters at all rather than dividing by zero", () => {
    expect(isEnglishish("")).toBe(false);
    expect(isEnglishish("2026 — 100%")).toBe(false);
  });
});

describe("findGaps — clustering is not over-eager", () => {
  const none: { url: string; title: string }[] = [];

  it("does not swallow a narrow topic into a broad one that merely contains it", () => {
    // Overlap alone scores a 2-word subset of a 7-word title at a perfect 1.0.
    // That collapsed 359 real pages into five clusters.
    const gaps = findGaps([
      pages("wati", "WhatsApp Pricing"),
      pages("aisensy", "WhatsApp Pricing"),
      pages("tidio", "The Complete Guide to WhatsApp Business Platform Template Message Pricing Tiers"),
      pages("interakt", "The Complete Guide to WhatsApp Business Platform Template Message Pricing Tiers"),
    ], none);
    expect(gaps.length).toBeGreaterThan(1);
  });

  it("still merges two phrasings of genuinely the same topic", () => {
    const gaps = findGaps([
      pages("wati", "WhatsApp Green Tick"),
      pages("aisensy", "How to Get the WhatsApp Green Tick"),
    ], none);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].covered).toHaveLength(2);
  });

  it("drops non-English pages before they can be clustered", () => {
    const gaps = findGaps([
      pages("wati", "体验新的Wati：您的升级版WhatsApp API服务"),
      pages("aisensy", "体验新的Wati：您的升级版WhatsApp API服务"),
    ], none);
    expect(gaps).toEqual([]);
  });
});

describe("cleanTitle", () => {
  it("strips the brand suffix competitors append to every title", () => {
    expect(cleanTitle("How to verify Facebook Business Manager Account? | AiSensy"))
      .toBe("How to verify Facebook Business Manager Account?");
    expect(cleanTitle("WhatsApp Broadcast Limits - Tidio")).toBe("WhatsApp Broadcast Limits");
  });

  it("leaves a title whose tail is part of the subject alone", () => {
    // The dash here is the title, not furniture — cutting it loses meaning.
    expect(cleanTitle("Red, Flagged, Restricted — What WhatsApp Is Telling You"))
      .toBe("Red, Flagged, Restricted — What WhatsApp Is Telling You");
  });

  it("handles an empty title", () => {
    expect(cleanTitle("")).toBe("");
  });
});

// ── What consensus alone cannot see ─────────────────────────────────────────
// On the first live run against 465 competitor pages, four of the top five
// gaps were listicles and the second was a 2022 product announcement two
// competitors still had in their sitemaps. All read as strong demand; none
// were worth writing. These penalties exist to correct exactly that.
describe("penalties", () => {
  const TERMS = ["whatsapp", "broadcast", "template"];
  const reasons = (label: string, topic = "whatsapp broadcast limit") =>
    penalties(label, topic, TERMS).map(p => p.reason).join(" | ");

  it("marks down listicles in every shape competitors write them", () => {
    expect(reasons("10 Best WhatsApp API Providers (2026) for B2C Teams")).toMatch(/listicle/);
    expect(reasons("Best Messaging Apps For Your Business")).toMatch(/listicle/);
    expect(reasons("Best WhatsApp AI Agents & chatbots: Top 10 (2026)")).toMatch(/listicle/);
    expect(reasons("16 Top Benefits of Chatbots for Businesses")).toMatch(/listicle/);
  });

  it("leaves an ordinary explainer alone", () => {
    expect(reasons("WhatsApp Co-existence: Everything you need to know")).toBe("");
    expect(reasons("How to use WhatsApp Payments for your business?")).toBe("");
  });

  it("marks down a product announcement whose moment has passed", () => {
    // Ranked second on real data. The launch was 2022.
    expect(reasons("Meta Announced WhatsApp Cloud API For All Businesses")).toMatch(/news announcement/);
    expect(reasons("Meta launches WhatsApp Business Calling")).toMatch(/news announcement/);
  });

  it("marks down a title carrying an old year, and leaves the current one", () => {
    const now = new Date("2026-10-03");
    expect(penalties("WhatsApp Pricing Guide 2023", "whatsapp pricing", TERMS, now).map(p => p.reason).join())
      .toMatch(/dated \(2023\)/);
    expect(penalties("WhatsApp Pricing Guide 2026", "whatsapp pricing", TERMS, now)).toEqual([]);
  });

  it("marks down a topic our product has nothing to do with", () => {
    // "What Is Customer Experience?" cleared the consensus floor on real data.
    expect(reasons("What Is Customer Experience?", "customer experience")).toMatch(/nothing to do with/);
  });

  it("applies no relevance penalty when no terms were supplied", () => {
    expect(penalties("What Is Customer Experience?", "customer experience", [])).toEqual([]);
  });

  it("stacks penalties when a title is several kinds of bad at once", () => {
    const p = penalties("10 Best CRM Tools Announced in 2023", "crm tool", TERMS, new Date("2026-10-03"));
    expect(p.length).toBeGreaterThanOrEqual(3);
  });
});

describe("scoreGap — the real ranking it had to fix", () => {
  const TERMS = ["whatsapp", "broadcast", "template", "payment", "api", "existence"];

  it("ranks a specific explainer above a better-covered listicle", () => {
    // Exactly the inversion from the live run: the listicle had FOUR
    // competitors, the explainer two, and the listicle won.
    const listicle = scoreGap("app business messaging", "Best Messaging Apps For Your Business", 4, TERMS);
    const explainer = scoreGap("coexistence everything know whatsapp", "WhatsApp Co-existence: Everything you need to know", 2, TERMS);
    expect(explainer).toBeGreaterThan(listicle);
  });

  it("ranks a how-to above a stale announcement with the same coverage", () => {
    const stale = scoreGap("api cloud whatsapp meta", "Meta Announced WhatsApp Cloud API For All Businesses", 2, TERMS);
    const howto = scoreGap("business payment use whatsapp", "How to use WhatsApp Payments for your business?", 2, TERMS);
    expect(howto).toBeGreaterThan(stale);
  });

  it("still prefers more competitors when neither title is penalised", () => {
    // The correction must not override consensus entirely — that was the
    // signal we started from.
    const two = scoreGap("business manager verify facebook", "How to verify Facebook Business Manager Account?", 2, TERMS);
    const three = scoreGap("business manager verify facebook", "How to verify Facebook Business Manager Account?", 3, TERMS);
    expect(three).toBeGreaterThan(two);
  });
});
