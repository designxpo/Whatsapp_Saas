import { describe, it, expect } from "vitest";
import { toDigits, isLikelyValidE164, normalizeE164 } from "@/lib/phone";

describe("toDigits", () => {
  it("strips non-digits", () => {
    expect(toDigits("+91 98765-43210")).toBe("919876543210");
    expect(toDigits(null)).toBe("");
  });
});

describe("isLikelyValidE164", () => {
  it("accepts a full international number", () => {
    expect(isLikelyValidE164("919876543210")).toBe(true);
    expect(isLikelyValidE164("+1 (415) 555-2671")).toBe(true);
  });
  it("accepts a 00-prefixed international number", () => {
    expect(isLikelyValidE164("00919876543210")).toBe(true);   // 00 + 919876543210
  });
  it("rejects a national trunk-prefix (leading 0) number", () => {
    expect(isLikelyValidE164("09876543210")).toBe(false);
  });
  it("rejects too short / too long", () => {
    expect(isLikelyValidE164("12345")).toBe(false);
    expect(isLikelyValidE164("1234567890123456")).toBe(false);
  });
});

describe("normalizeE164", () => {
  it("returns bare digits when already valid", () => {
    expect(normalizeE164("+91 98765 43210")).toBe("919876543210");
  });
  it("prepends a default country code for local numbers", () => {
    expect(normalizeE164("09876543210", "91")).toBe("919876543210");
  });
  it("returns null when it can't be made valid", () => {
    expect(normalizeE164("123")).toBeNull();
    expect(normalizeE164("09876543210")).toBeNull();   // local, no default cc
  });
});
