// The classification that decides whether a quiet-looking chat gets a nudge or
// the answer we owe it.
//
// These cases are written from a real production thread: the assistant asked
// "would you like to explore a simple mantra or breathing practice?", the
// customer answered "Yes it will help me", both reply attempts failed into the
// canned placeholder, and 3.5 hours later the follow-up sweep asked the SAME
// question again — because "our message is the most recent" was being read as
// "the customer went quiet".

import { describe, it, expect } from "vitest";
import { followupState, isCannedNonAnswer, FALLBACK_REPLY } from "../llm";

const us = (body: string) => ({ role: "assistant" as const, body });
const them = (body: string) => ({ role: "user" as const, body });

describe("isCannedNonAnswer", () => {
  it("recognises the placeholders that carry no information", () => {
    expect(isCannedNonAnswer(FALLBACK_REPLY)).toBe(true);
    expect(isCannedNonAnswer("Thanks for your message! A team member will get back to you shortly.")).toBe(true);
  });

  it("is insensitive to the whitespace and casing a transcript round-trip adds", () => {
    expect(isCannedNonAnswer("  Thanks for your message!  A team member will get back to you shortly.  ")).toBe(true);
    expect(isCannedNonAnswer("thanks for your message! a team member will get back to you shortly.")).toBe(true);
  });

  it("does not mistake a real answer for a placeholder", () => {
    expect(isCannedNonAnswer("Detachment, or Vairagya, is not about being cold.")).toBe(false);
    // Superficially similar, but a real handoff sentence a human might type.
    expect(isCannedNonAnswer("A team member will call you at 4pm.")).toBe(false);
    expect(isCannedNonAnswer("")).toBe(false);
    expect(isCannedNonAnswer(null)).toBe(false);
    expect(isCannedNonAnswer(undefined)).toBe(false);
  });
});

describe("followupState", () => {
  it("calls it quiet when they genuinely stopped replying to a real message", () => {
    expect(followupState([
      them("what do you teach?"),
      us("We run daily guided meditation sessions. Would you like the schedule?"),
    ])).toBe("quiet");
  });

  it("still calls it quiet when a placeholder is followed by a real answer", () => {
    // The trailing run must be ENTIRELY placeholders. A real reply after one
    // means we did answer, so a nudge is the right call.
    expect(followupState([
      them("are you there?"),
      us(FALLBACK_REPLY),
      us("Sorry about that — yes, here's the schedule you asked for."),
    ])).toBe("quiet");
  });

  it("owes an answer on the exact production thread that surfaced this", () => {
    expect(followupState([
      us("Would you like to explore a simple mantra or breathing practice today?"),
      them("Yes it will help me"),
      them("I am also very close to my mental peace"),
      us(FALLBACK_REPLY),
      us(FALLBACK_REPLY),
    ])).toBe("answer_owed");
  });

  it("owes an answer after a single failed attempt too, not just a repeat", () => {
    expect(followupState([
      us("Shall I send the details?"),
      them("yes please"),
      us(FALLBACK_REPLY),
    ])).toBe("answer_owed");
  });

  it("owes an answer when the customer simply spoke last", () => {
    expect(followupState([
      us("Would you like the schedule?"),
      them("yes"),
    ])).toBe("answer_owed");
  });

  it("does not owe an answer when the placeholder is all there has ever been", () => {
    // No customer message precedes our trailing placeholders — there is nothing
    // to answer, so re-running the reply pipeline would just fail again.
    expect(followupState([us(FALLBACK_REPLY)])).toBe("quiet");
    expect(followupState([])).toBe("quiet");
  });

  it("ignores blank messages rather than letting one break the trailing run", () => {
    expect(followupState([
      us("Would you like a practice to try?"),
      them("Yes it will help me"),
      us("   "),
      us(FALLBACK_REPLY),
    ])).toBe("answer_owed");
  });
});
