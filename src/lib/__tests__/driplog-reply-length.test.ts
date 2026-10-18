// A reply in the drip log should be readable.
//
// replyLine cut every typed message at a hard-coded 60 characters. That was
// right while mx_RNR_DRIP_LOGS held 256: one long sentence would have eaten
// the field and pushed out the history around it.
//
// The field holds 1,000 now. Seen live on 14 Oct, the same 69-character
// sentence three times over:
//
//   14Oct 10:54 ← Hi! I'd like to learn more about the courses offered by Anal
//
// Cut mid-word, and in this instance badly. These pin the two properties that
// matter: the message survives, and when it genuinely cannot, the cut is on a
// word boundary and visibly marked.
import { describe, it, expect } from "vitest";
import { replyLine, replyMaxText, dripLine, DRIP_LOG_MAX } from "../driplog";

const AT = new Date("2026-10-14T05:24:00Z");
/** The exact message from the live field. */
const REAL = "Hi! I'd like to learn more about the courses offered by AnalytixLabs.";

describe("the message that was being cut", () => {
  it("now survives whole", () => {
    expect(REAL.length).toBe(69);
    expect(replyLine(AT, REAL)).toContain("offered by AnalytixLabs.");
  });

  it("does not end in the truncation that was reported", () => {
    expect(replyLine(AT, REAL)).not.toMatch(/by Anal$/);
  });

  it("still carries the stamp and the inbound arrow", () => {
    const line = replyLine(AT, REAL);
    expect(line).toMatch(/^\d{2}\w{3} \d{2}:\d{2} ←/);
  });
});

describe("the budget scales with the field", () => {
  it("is a third of the field, never less than 80", () => {
    expect(replyMaxText()).toBe(Math.max(80, Math.floor(DRIP_LOG_MAX / 3)));
    expect(replyMaxText()).toBeGreaterThanOrEqual(80);
  });

  it("leaves room for the history around it", () => {
    // The original concern was one message crowding out the rest. A third of
    // the field still allows two more beside it.
    expect(replyMaxText() * 3).toBeLessThanOrEqual(Math.max(240, DRIP_LOG_MAX));
  });
});

describe("when a message really is too long", () => {
  const LONG = "I would like to understand the complete curriculum including every module and the placement process and the fee structure and the EMI options and whether there is a classroom batch in Delhi NCR starting soon because I need to plan my leave";

  it("cuts on a word boundary, never mid-word", () => {
    const body = replyLine(AT, LONG).replace(/^\S+ \S+ ← /, "");
    expect(body.endsWith("…")).toBe(true);
    const lastWord = body.slice(0, -1).trimEnd().split(" ").pop()!;
    // Every surviving word must be a whole word from the original.
    expect(LONG.split(" ")).toContain(lastWord);
  });

  it("says it was cut", () => {
    expect(replyLine(AT, LONG)).toContain("…");
  });

  it("stays within the budget", () => {
    const body = replyLine(AT, LONG).replace(/^\S+ \S+ ← /, "");
    expect(body.length).toBeLessThanOrEqual(replyMaxText());
  });

  it("hard-cuts a single unbroken token rather than losing all of it", () => {
    // 300 characters with no space is not a sentence, and protecting a word
    // boundary that does not exist would throw the lot away.
    const blob = "x".repeat(300);
    const body = replyLine(AT, blob).replace(/^\S+ \S+ ← /, "");
    expect(body.length).toBeGreaterThan(50);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("what must not change", () => {
  it("a short tap goes in whole, with no ellipsis", () => {
    for (const tap of ["Yes, call me now", "Close my enquiry", "Request a callback"]) {
      expect(replyLine(AT, tap)).toContain(tap);
      expect(replyLine(AT, tap)).not.toContain("…");
    }
  });

  it("collapses newlines so one reply stays one line", () => {
    // Lines are the unit the log trims by; a reply spanning three of them
    // would make the trimming drop parts of a single message.
    expect(replyLine(AT, "one\ntwo\nthree")).not.toContain("\n");
  });

  it("an outbound line is untouched by any of this", () => {
    expect(dripLine(AT, "out", "about us")).toContain("→ about us");
  });
});
