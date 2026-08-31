import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { constEq, verifyMetaSignature, verifySignedRequest, verifyResendSignature } from "@/lib/apiauth";

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

describe("verifyResendSignature", () => {
  // Resend's webhooks are Svix under the hood: sign `{id}.{timestamp}.{body}`
  // with HMAC-SHA256 keyed by the base64-decoded part of the secret after
  // "whsec_", base64-encode the digest, and send it as "v1,<sig>".
  const secret = "whsec_" + Buffer.from("a-fake-signing-key-32-bytes-long").toString("base64");
  const raw = JSON.stringify({ type: "email.delivered", data: { email_id: "abc-123" } });
  const id = "msg_2abc";
  const now = () => String(Math.floor(Date.now() / 1000));

  const sign = (rawBody: string, msgId: string, ts: string, key: string) => {
    const keyPart = key.startsWith("whsec_") ? key.slice(6) : key;
    const hmacKey = Buffer.from(keyPart, "base64");
    const sig = crypto.createHmac("sha256", hmacKey).update(`${msgId}.${ts}.${rawBody}`).digest("base64");
    return `v1,${sig}`;
  };

  it("accepts a correctly signed webhook", () => {
    const ts = now();
    const headers = { id, timestamp: ts, signature: sign(raw, id, ts, secret) };
    expect(verifyResendSignature(raw, headers, secret)).toBe(true);
  });

  it("accepts when the header carries multiple space-separated signatures (key rotation) and one matches", () => {
    const ts = now();
    const real = sign(raw, id, ts, secret);
    const headers = { id, timestamp: ts, signature: `v1,bogusvalueaaaa ${real}` };
    expect(verifyResendSignature(raw, headers, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = now();
    const headers = { id, timestamp: ts, signature: sign(raw, id, ts, secret) };
    expect(verifyResendSignature(raw + " ", headers, secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const ts = now();
    const wrongSecret = "whsec_" + Buffer.from("a-completely-different-key-value").toString("base64");
    const headers = { id, timestamp: ts, signature: sign(raw, id, ts, wrongSecret) };
    expect(verifyResendSignature(raw, headers, secret)).toBe(false);
  });

  it("rejects a stale timestamp outside the 5-minute tolerance", () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 600);   // 10 min old
    const headers = { id, timestamp: staleTs, signature: sign(raw, id, staleTs, secret) };
    expect(verifyResendSignature(raw, headers, secret)).toBe(false);
  });

  it("fails CLOSED on a missing secret or missing headers", () => {
    const ts = now();
    const headers = { id, timestamp: ts, signature: sign(raw, id, ts, secret) };
    expect(verifyResendSignature(raw, headers, undefined)).toBe(false);
    expect(verifyResendSignature(raw, { id: null, timestamp: ts, signature: headers.signature }, secret)).toBe(false);
    expect(verifyResendSignature(raw, { id, timestamp: null, signature: headers.signature }, secret)).toBe(false);
    expect(verifyResendSignature(raw, { id, timestamp: ts, signature: null }, secret)).toBe(false);
  });
});
