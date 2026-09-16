// Purpose-separated keys derived from ADMIN_JWT_SECRET.
//
// The session JWT already uses ADMIN_JWT_SECRET directly, and pending login
// tokens use it with a `purpose` claim (see auth.ts). Anything that encrypts or
// signs something OTHER than a login step derives its own key here instead of
// reusing that value, so two subsystems can never read each other's material.

import { hkdfSync } from "crypto";

export function deriveKey(info: string, length = 32): Buffer {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_JWT_SECRET missing or too short (need ≥32 chars)");
  return Buffer.from(hkdfSync("sha256", Buffer.from(s, "utf8"), Buffer.alloc(0), Buffer.from(info, "utf8"), length));
}

export const TOTP_ENC_KEY_INFO = "alabs-connect/2fa-secret-encryption/v1";
export const WEBAUTHN_CHALLENGE_KEY_INFO = "alabs-connect/webauthn-challenge/v1";
