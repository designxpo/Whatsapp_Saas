import { describe, it, expect } from "vitest";
import { newOtpCode, hashOtp, safeEqual } from "../otp";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";

describe("otp primitives", () => {
  it("generates 4-digit codes (leading zeros kept)", () => {
    for (let i = 0; i < 200; i++) expect(newOtpCode()).toMatch(/^\d{4}$/);
  });

  it("hash is deterministic and keyed by tenant, phone, code, and secret", () => {
    const h = hashOtp(T1, "919876543210", "482913", "pepper");
    expect(h).toBe(hashOtp(T1, "919876543210", "482913", "pepper"));
    expect(h).not.toBe(hashOtp(T2, "919876543210", "482913", "pepper"));   // other tenant
    expect(h).not.toBe(hashOtp(T1, "919876543211", "482913", "pepper"));   // other phone
    expect(h).not.toBe(hashOtp(T1, "919876543210", "482914", "pepper"));   // other code
    expect(h).not.toBe(hashOtp(T1, "919876543210", "482913", "other"));    // other secret
    expect(h).toMatch(/^[0-9a-f]{64}$/);                                   // sha256 hex
  });

  it("safeEqual: equal, unequal, and length-mismatch inputs", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc123", "abc1234")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
