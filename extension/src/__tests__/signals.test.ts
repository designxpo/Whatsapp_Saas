import { describe, it, expect } from "vitest";
import { scoreSignal, signalsFromCandidates, SIGNAL_LIMIT } from "../signals.js";

describe("scoreSignal", () => {
  it("catches a recommendation ask", () => {
    const s = scoreSignal("Anyone recommend a good tool for WhatsApp broadcasts?");
    expect(s?.category).toBe("recommendation-ask");
    expect(s?.snippet).toContain("Anyone recommend");
  });

  it("catches a pain-point complaint", () => {
    const s = scoreSignal("I'm so frustrated with our current CRM, it keeps losing leads.");
    expect(s?.category).toBe("pain-point");
  });

  it("catches switching intent", () => {
    const s = scoreSignal("Looking at alternatives to our current helpdesk software.");
    expect(s?.category).toBe("switching-intent");
  });

  it("catches option evaluation", () => {
    expect(scoreSignal("Has anyone tried Talko vs Interakt for WhatsApp?")?.category).toBe("evaluating");
    expect(scoreSignal("Is it worth the price for a small team?")?.category).toBe("evaluating");
  });

  it("catches a pricing question", () => {
    const s = scoreSignal("How much does a WhatsApp API tool cost for 5 agents?");
    expect(s?.category).toBe("budget-question");
  });

  it("quotes only the matching sentence, not the whole post", () => {
    const s = scoreSignal("Great weekend everyone. Anyone recommend a tool for customer support? Thanks in advance.");
    expect(s?.snippet).toBe("Anyone recommend a tool for customer support?");
  });

  it("returns null for ordinary chatter", () => {
    expect(scoreSignal("Just had lunch, back at my desk now.")).toBeNull();
    expect(scoreSignal("")).toBeNull();
  });
});

describe("signalsFromCandidates", () => {
  it("keeps only candidates that read as a signal", () => {
    const { signals, total } = signalsFromCandidates([
      { platform: "reddit", author: "u/alex", text: "Anyone recommend a tool for order tracking?", permalink: "https://reddit.com/r/x/1" },
      { platform: "reddit", author: "u/sam", text: "Nice, congrats on the launch!", permalink: "https://reddit.com/r/x/2" },
    ]);
    expect(total).toBe(1);
    expect(signals[0]).toMatchObject({ author: "u/alex", category: "recommendation-ask" });
  });

  it("dedupes repeat sightings of the same permalink", () => {
    const { signals, total } = signalsFromCandidates([
      { platform: "x", author: "@jane", text: "Sick of our current invoicing tool.", permalink: "https://x.com/jane/1" },
      { platform: "x", author: "@jane", text: "Sick of our current invoicing tool.", permalink: "https://x.com/jane/1" },
    ]);
    expect(total).toBe(1);
    expect(signals).toHaveLength(1);
  });

  it("dedupes by author + text start when there's no permalink", () => {
    const { total } = signalsFromCandidates([
      { platform: "linkedin", author: "Priya Sharma", text: "Looking for a good alternative to our current tool for the team." },
      { platform: "linkedin", author: "Priya Sharma", text: "Looking for a good alternative to our current tool for the team." },
    ]);
    expect(total).toBe(1);
  });

  it("keeps distinct posts from the same author separate", () => {
    const { total } = signalsFromCandidates([
      { platform: "discord", author: "sam", text: "Anyone recommend a good scheduling app?" },
      { platform: "discord", author: "sam", text: "How much does a CRM usually cost per seat?" },
    ]);
    expect(total).toBe(2);
  });

  it("caps the list but reports the true total", () => {
    const many = Array.from({ length: SIGNAL_LIMIT + 5 }, (_, i) => ({
      platform: "x", author: `@user${i}`, text: `Anyone recommend a tool for task ${i}?`, permalink: `https://x.com/user${i}/1`,
    }));
    const { signals, total } = signalsFromCandidates(many);
    expect(total).toBe(SIGNAL_LIMIT + 5);
    expect(signals).toHaveLength(SIGNAL_LIMIT);
  });

  it("survives a collector that returns nothing useful", () => {
    expect(signalsFromCandidates([]).signals).toEqual([]);
    // @ts-expect-error — the injected collector is not type-checked
    expect(signalsFromCandidates(null).signals).toEqual([]);
    // @ts-expect-error — same
    expect(signalsFromCandidates([null, {}, { text: "" }]).signals).toEqual([]);
  });
});
