import { describe, it, expect } from "vitest";
import { plausiblePhone } from "../leadsquared";

// Fake/typo numbers that reach CRM auto-create (web-chat visitors type junk).
// LeadSquared rejects them → the push retries to DEAD and reddens the health
// card. plausiblePhone gates them so they're a clean no-op, not a queue entry.
describe("plausiblePhone", () => {
  it("rejects obviously-bogus numbers", () => {
    expect(plausiblePhone("0000000000")).toBe(false);
    expect(plausiblePhone("1111111111")).toBe(false);
    expect(plausiblePhone("12345")).toBe(false);
    expect(plausiblePhone("0999999999")).toBe(false);
    expect(plausiblePhone(null)).toBe(false);
  });
  it("accepts real numbers", () => {
    expect(plausiblePhone("9999730196")).toBe(true);
    expect(plausiblePhone("919999730196")).toBe(true);
  });
});
