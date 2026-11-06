// Workspace sign-in, signup and password-reset codes are 6 digits. The tenant
// WhatsApp OTP product (/api/otp/*) keeps its 4 digits — tenants' own sites
// and Meta authentication templates are built around that length.
import { describe, it, expect } from "vitest";
import { newEmailOtpCode, verifyEmailOtp, EMAIL_OTP_LENGTH } from "../emailotp";
import { newOtpCode } from "../otp";

describe("email OTP length", () => {
  it("email codes are 6 crypto-random digits, leading zeros kept", () => {
    expect(EMAIL_OTP_LENGTH).toBe(6);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = newEmailOtpCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(290);
  });

  it("the public tenant OTP stays at 4 digits", () => {
    for (let i = 0; i < 200; i++) expect(newOtpCode()).toMatch(/^\d{4}$/);
  });

  it("a 4-digit (or 7-digit) code is refused before anything is looked up", async () => {
    expect(await verifyEmailOtp("a@b.co", "login", "1234")).toEqual({ ok: false, error: "Enter the 6-digit code" });
    expect(await verifyEmailOtp("a@b.co", "reset", "1234567")).toEqual({ ok: false, error: "Enter the 6-digit code" });
  });
});
