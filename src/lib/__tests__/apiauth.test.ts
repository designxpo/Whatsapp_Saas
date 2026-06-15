import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";

describe("constEq", () => {
  it("matches equal strings", () => {
    expect(constEq("hunter2", "hunter2")).toBe(true);
  });
  it("rejects different strings", () => {
    expect(constEq("hunter2", "hunter3")).toBe(false);
  });
  it("rejects different lengths", () => {
    expect(constEq("abc", "abcd")).toBe(false);
  });
  it("returns false when expected is undefined (unset env)", () => {
    expect(constEq("anything", undefined)).toBe(false);
  });
});

describe("verifyMetaSignature", () => {
  const secret = "test_app_secret";
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sign = (body: string, key: string) =>
    "sha256=" + crypto.createHmac("sha256", key).update(body, "utf8").digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(raw, sign(raw, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(raw, secret);
    expect(verifyMetaSignature(raw + " ", sig, secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyMetaSignature(raw, sign(raw, "wrong"), secret)).toBe(false);
  });

  it("fails CLOSED when the secret is not configured", () => {
    expect(verifyMetaSignature(raw, sign(raw, secret), undefined)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw, secret), "")).toBe(false);
  });

  it("rejects a missing or malformed signature header", () => {
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, "deadbeef", secret)).toBe(false); // no sha256= prefix
  });
});
