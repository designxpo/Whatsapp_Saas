// The rules that decide whether an AI reply to a Google review may go public
// without a person (lib/review-policy.ts).
import { describe, it, expect } from "vitest";
import { decideAutoPost, ruleTopics, parseAiDraft, unreadableLanguage, DEFAULT_HOLD_FOR, normalizeHoldFor, type PolicyInput } from "../review-policy";

const ok = { concerns: [], confident: true };
const base = (p: Partial<PolicyInput>): PolicyInput => ({ rating: 5, text: "Lovely food and quick service", autoMinStars: 4, holdFor: DEFAULT_HOLD_FOR, ai: ok, ...p });

describe("review reply approval rules", () => {
  it("lets a plain happy review post on its own", () => {
    expect(decideAutoPost(base({}))).toMatchObject({ autoPost: true, reasons: [], complaint: false });
  });

  it("never auto-post beats everything, even a perfect review", () => {
    const d = decideAutoPost(base({ autoMinStars: 6 }));
    expect(d.autoPost).toBe(false);
    expect(d.reasons[0]).toMatch(/Never auto-post/);
  });

  it("holds a low rating below the threshold", () => {
    expect(decideAutoPost(base({ rating: 3, text: "It was ok" })).reasons[0]).toMatch(/3★ is below your auto-post setting \(4★ and up\)/);
  });

  it("a five-star review that raises a refund or overcharge still waits", () => {
    const d = decideAutoPost(base({ text: "Food was amazing but I was charged twice, please refund" }));
    expect(d.autoPost).toBe(false);
    expect(d.topics).toContain("billing");
    expect(d.reasons.join(" ")).toMatch(/Refunds, billing disputes or overcharging — mentions “charged twice”/);
    expect(d.complaint).toBe(true);
  });

  it("reads safety, legal, personal details and strong complaints — in English, Hindi and Hinglish", () => {
    expect(ruleTopics("my son got sick after eating here").map(t => t.category)).toContain("safety");
    expect(ruleTopics("I will go to consumer court over this fraud").map(t => t.category)).toContain("legal");
    expect(ruleTopics("call me on 98765 43210").map(t => t.category)).toContain("personal_info");
    expect(ruleTopics("mail me at a.b@example.com").map(t => t.category)).toContain("personal_info");
    expect(ruleTopics("staff was rude, never again").map(t => t.category)).toContain("strong_complaint");
    expect(ruleTopics("service ekdum bakwas thi").map(t => t.category)).toContain("strong_complaint");
    expect(ruleTopics("खाना बहुत घटिया था").map(t => t.category)).toContain("strong_complaint");
    expect(ruleTopics("मुझे पैसे वापस चाहिए").map(t => t.category)).toContain("billing");
    expect(ruleTopics("Great haircut, friendly team")).toEqual([]);
  });

  it("an owner can turn a topic off, but uncertainty always holds", () => {
    const holdFor = normalizeHoldFor({ ...DEFAULT_HOLD_FOR, billing: false });
    expect(decideAutoPost(base({ text: "Great, though the bill was wrong at first", holdFor })).autoPost).toBe(true);
    expect(decideAutoPost(base({ text: "Great, though the bill was wrong at first", holdFor, ai: null })).reasons).toEqual(["Couldn't check this review automatically."]);
    expect(decideAutoPost(base({ ai: { concerns: [], confident: false } })).reasons).toEqual(["The AI wasn't sure how to read this review."]);
  });

  it("a topic only the AI noticed still holds the reply", () => {
    const d = decideAutoPost(base({ text: "Interesting experience, the manager will hear from my advocate friend", ai: { concerns: ["legal"], confident: true } }));
    expect(d.autoPost).toBe(false);
    expect(d.reasons.some(r => /Legal threats/.test(r))).toBe(true);
  });

  it("holds a review in a script the rules can't read, and one with no star rating", () => {
    expect(unreadableLanguage("சாப்பாடு நன்றாக இருந்தது")).toBe(true);
    expect(unreadableLanguage("Bahut accha khana, धन्यवाद")).toBe(false);
    expect(decideAutoPost(base({ text: "சாப்பாடு நன்றாக இருந்தது" })).reasons).toContain("Written in a language Talko can't check automatically.");
    expect(decideAutoPost(base({ rating: 0 })).reasons).toContain("Google didn't give a star rating.");
  });

  it("reads the AI's JSON answer, and treats anything else as unchecked", () => {
    expect(parseAiDraft('{"reply":"Thanks Asha!","concerns":["billing"],"confident":true}')).toEqual({ reply: "Thanks Asha!", ai: { concerns: ["billing"], confident: true } });
    expect(parseAiDraft('```json\n{"reply":"Thanks!","concerns":[],"confident":false}\n```').ai).toEqual({ concerns: [], confident: false });
    expect(parseAiDraft('{"reply":"Thanks!"}')).toEqual({ reply: "Thanks!", ai: null });
    expect(parseAiDraft("Thank you so much for visiting!")).toEqual({ reply: "Thank you so much for visiting!", ai: null });
    expect(parseAiDraft('{"broken": ')).toEqual({ reply: "", ai: null });
    expect(parseAiDraft('{"reply":"Hi","concerns":["made_up"],"confident":true}').ai).toEqual({ concerns: [], confident: true });
  });
});
