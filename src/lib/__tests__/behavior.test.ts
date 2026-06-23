import { describe, it, expect } from "vitest";
import { readBehavior, behaviorBlock } from "@/lib/behavior";

const u = (body: string) => ({ role: "user" as const, body });
const a = (body: string) => ({ role: "assistant" as const, body });

describe("readBehavior — stage", () => {
  const stage = (msg: string) => readBehavior([u(msg)]).stage;
  it("classifies a greeting", () => expect(stage("hi")).toBe("greeting"));
  it("classifies high intent (enrol/pay)", () => {
    expect(stage("I want to enroll, how do I pay?")).toBe("high_intent");
    expect(stage("ready to join the course")).toBe("high_intent");
  });
  it("classifies an objection (price)", () => expect(stage("this is too expensive for me")).toBe("objection"));
  it("classifies evaluating (comparison / specifics)", () => {
    expect(stage("what is the difference between the two courses?")).toBe("evaluating");
    expect(stage("tell me about placements and syllabus")).toBe("evaluating");
  });
  it("classifies browsing (general info)", () => expect(stage("what courses do you offer?")).toBe("browsing"));
  it("classifies an existing-customer support issue", () => expect(stage("I can't login to my account")).toBe("support"));
  it("falls back to neutral", () => expect(stage("the weather is fine")).toBe("neutral"));
  it("reads the LATEST user message, not earlier ones", () => {
    expect(readBehavior([u("what is data science"), a("…"), u("ok I want to enroll now")]).stage).toBe("high_intent");
  });
});

describe("readBehavior — sentiment & urgency", () => {
  it("detects frustration", () => expect(readBehavior([u("this is useless, third time I'm asking")]).sentiment).toBe("frustrated"));
  it("detects positivity", () => expect(readBehavior([u("thanks, that's perfect 😊")]).sentiment).toBe("positive"));
  it("detects urgency", () => expect(readBehavior([u("I need to enroll today, last date!")]).urgent).toBe(true));
  it("neutral by default", () => {
    const r = readBehavior([u("what is the duration")]);
    expect(r.sentiment).toBe("neutral");
    expect(r.urgent).toBe(false);
  });
});

describe("behaviorBlock — prompt rendering", () => {
  it("renders guidance for a high-intent lead", () => {
    const block = behaviorBlock(readBehavior([u("I'm ready to enroll, how do I pay?")]));
    expect(block).toContain("Customer read");
    expect(block.toLowerCase()).toContain("next step");
  });
  it("leads with empathy for a frustrated customer", () => {
    expect(behaviorBlock({ sentiment: "frustrated", stage: "support", urgent: false }).toLowerCase()).toContain("empathy");
  });
  it("is EMPTY for a plain neutral message (no prompt bloat)", () => {
    expect(behaviorBlock({ sentiment: "neutral", stage: "neutral", urgent: false })).toBe("");
  });
});
