import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { constEq, verifyMetaSignature, verifySignedRequest } from "@/lib/apiauth";

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

describe("verifySignedRequest", () => {
  const secret = "test_app_secret";
  // Build a Meta-style signed_request: base64url(sig) . base64url(payload)
  const make = (payload: object, key: string) => {
    const encPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", key).update(encPayload).digest("base64url");
    return `${sig}.${encPayload}`;
  };
  const payload = { user_id: "1234567890", algorithm: "HMAC-SHA256", issued_at: 1700000000 };

  it("decodes a correctly signed request", () => {
    const out = verifySignedRequest(make(payload, secret), secret);
    expect(out).not.toBeNull();
    expect(out!.user_id).toBe("1234567890");
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifySignedRequest(make(payload, "wrong"), secret)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const good = make(payload, secret);
    const tampered = good.split(".")[0] + "." + Buffer.from(JSON.stringify({ user_id: "evil" })).toString("base64url");
    expect(verifySignedRequest(tampered, secret)).toBeNull();
  });

  it("fails CLOSED on missing secret or malformed input", () => {
    expect(verifySignedRequest(make(payload, secret), undefined)).toBeNull();
    expect(verifySignedRequest("", secret)).toBeNull();
    expect(verifySignedRequest("no-dot-here", secret)).toBeNull();
  });
});
