import { describe, it, expect } from "vitest";
import { hasUsableText, readableCharCount } from "../kb";

// Regression for a defect found on a LIVE tenant: a scanned PDF was ingested,
// marked "ready", and shown in the portal as a working knowledge base. Its
// entire stored content was 53 characters of page furniture, so every AI answer
// that claimed to be grounded in it was grounded in nothing.
describe("usable-text guard", () => {
  // The exact text the tenant's document extracted to.
  const SCANNED_PDF = "\n\n-- 1 of 2 --\n\n\n-- 2 of 2 --\n";

  it("rejects a scanned PDF that extracted only page markers", () => {
    expect(readableCharCount(SCANNED_PDF)).toBe(0);
    expect(hasUsableText(SCANNED_PDF)).toBe(false);
  });

  it("rejects empty and whitespace-only extractions", () => {
    for (const t of ["", "   ", "\n\n\t\n", null as unknown as string, undefined as unknown as string]) {
      expect(hasUsableText(t)).toBe(false);
    }
  });

  it("rejects page markers in the other shapes parsers emit", () => {
    expect(hasUsableText("- 1 of 12 -")).toBe(false);
    expect(hasUsableText("--- 3 of 3 ---")).toBe(false);
    expect(hasUsableText("  -- 1 of 2 --  \n  -- 2 of 2 --  ")).toBe(false);
  });

  it("accepts a genuinely short document — brevity is not emptiness", () => {
    // A tenant may legitimately upload a one-line price list; the guard must
    // separate "no text" from "not much text", or it becomes its own silent bug.
    expect(hasUsableText("Membership: 1500 rupees per month. Timings 6am to 8pm.")).toBe(true);
  });

  it("accepts real content that also contains page markers", () => {
    const real = "-- 1 of 2 --\nBolt Taekwondo Club\nMonthly fee is 1500 rupees.\n-- 2 of 2 --\nCall 9319044504 to enrol.";
    expect(hasUsableText(real)).toBe(true);
  });

  it("counts letters and digits, not punctuation or layout", () => {
    expect(readableCharCount("... --- ,,, \n\n ||| ")).toBe(0);
    expect(readableCharCount("abc 123")).toBe(6);
  });

  it("handles non-Latin scripts — a Hindi KB is not an empty one", () => {
    expect(hasUsableText("बोल्ट ताइक्वांडो क्लब की मासिक फीस पंद्रह सौ रुपये है।")).toBe(true);
  });
});
