import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/team";

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", () => {
    const stored = hashPassword("Sup3r$ecret");
    expect(verifyPassword("Sup3r$ecret", stored)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const stored = hashPassword("Sup3r$ecret");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("uses a random salt (same password → different hashes)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects a malformed stored value", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "no-colon")).toBe(false);
  });

  it("produces a salt:hash shape", () => {
    const [salt, hash] = hashPassword("abc").split(":");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{128}$/);
  });
});
