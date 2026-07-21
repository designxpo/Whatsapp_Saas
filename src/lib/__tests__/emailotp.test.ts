import { describe, it, expect } from "vitest";
import { hashEmailOtp } from "../emailotp";

describe("email otp primitives", () => {
  it("hash is deterministic and keyed by email, purpose, code, and secret", () => {
    const h = hashEmailOtp("owner@example.com", "login", "4821", "pepper");
    expect(h).toBe(hashEmailOtp("owner@example.com", "login", "4821", "pepper"));
    expect(h).not.toBe(hashEmailOtp("other@example.com", "login", "4821", "pepper"));   // other email
    expect(h).not.toBe(hashEmailOtp("owner@example.com", "signup", "4821", "pepper"));  // other purpose
    expect(h).not.toBe(hashEmailOtp("owner@example.com", "login", "4822", "pepper"));   // other code
    expect(h).not.toBe(hashEmailOtp("owner@example.com", "login", "4821", "other"));    // other secret
    expect(h).toMatch(/^[0-9a-f]{64}$/);                                                // sha256 hex
  });
});
