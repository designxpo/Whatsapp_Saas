// Webhook signature checks. Every tool signs differently — hex or base64, the
// raw body or a timestamp joined to it — but all of them are an HMAC compared
// in constant time, so the comparison lives in one place.

import { createHmac, timingSafeEqual } from "crypto";

export function hmac(secret: string, message: string, encoding: "hex" | "base64", algo: "sha256" = "sha256"): string {
  return createHmac(algo, secret).update(message, "utf8").digest(encoding);
}

/** Constant-time string comparison; false for any length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
