// TOTP (RFC 6238) on top of HOTP (RFC 4226), built on node's own crypto.
//
// Deliberately not an npm dependency. The whole algorithm is ~40 lines of
// HMAC-SHA1 and a modulo, RFC 6238 publishes official test vectors, and this
// file is pinned to those vectors in totp.test.ts — so the correctness argument
// here is stronger than "a package with a lot of downloads". It also keeps the
// second authentication factor free of a supply chain we do not control, which
// matters rather more than usual in a codebase being hardened after a breach.
//
// SHA-1 is not a weakness here: HMAC-SHA1 is unbroken (collisions do not affect
// HMAC), and it is what Google Authenticator, Authy, 1Password and every other
// authenticator app default to. Choosing SHA-256 would buy nothing and quietly
// break enrolment on some apps.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_PERIOD = 30;   // seconds per code
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  // Authenticator apps show the secret in spaced, lowercase-tolerant groups and
  // people paste it back with the spaces still in it.
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// 160-bit secret — RFC 4226 §4 R6 requires at least 128 bits and recommends 160,
// which is also exactly one SHA-1 block's worth of key.
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks
  // which 4 bytes of the MAC become the code.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function stepAt(nowMs: number, period = TOTP_PERIOD): number {
  return Math.floor(nowMs / 1000 / period);
}

export function totpAt(secretB32: string, step: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), step, digits);
}

function constEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface TotpCheck {
  ok: boolean;
  /** The time-step the code matched, for the caller to persist as spent. */
  step: number;
}

/**
 * `window` accepts codes one step either side of now (±30s) to absorb clock
 * drift between the phone and the server — the usual compromise, and what
 * every authenticator expects.
 *
 * `minStep` is the replay guard: the highest step this account has already
 * spent. Without it a 6-digit code stays valid for its whole 30-90s window, so
 * anyone who observed it (shoulder-surfing, a logged request, a phishing proxy)
 * could re-use it before it expired. Codes are therefore strictly
 * single-use per account.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { now?: number; window?: number; minStep?: number; digits?: number; period?: number } = {},
): TotpCheck {
  const digits = opts.digits ?? TOTP_DIGITS;
  const period = opts.period ?? TOTP_PERIOD;
  const window = opts.window ?? 1;
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== digits) return { ok: false, step: 0 };

  const key = base32Decode(secretB32);
  const now = stepAt(opts.now ?? Date.now(), period);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (opts.minStep !== undefined && step <= opts.minStep) continue;
    if (constEq(hotp(key, step, digits), cleaned)) return { ok: true, step };
  }
  return { ok: false, step: 0 };
}

// otpauth:// URI that authenticator apps read from the QR code.
// Built by hand rather than with URLSearchParams because that encodes spaces as
// "+", and several apps render the issuer literally — "Alabs+Connect".
export function provisioningUri(secret: string, account: string, issuer = "Alabs Connect"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = [
    `secret=${secret}`,
    `issuer=${encodeURIComponent(issuer)}`,
    "algorithm=SHA1",
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_PERIOD}`,
  ].join("&");
  return `otpauth://totp/${label}?${q}`;
}
