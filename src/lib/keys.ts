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

// The "alabs-connect" in the strings below is the repository's old internal
// name, and it must STAY. These are HKDF info parameters, not labels: they are
// inputs to key derivation, so renaming one derives a different key and every
// secret already encrypted under the old one becomes permanently unreadable.
// The brand name was corrected everywhere a PERSON can see it (the authenticator
// issuer in totp.ts, the webhook test ping in integrations.ts); these are not
// those. Leave them alone.
export const TOTP_ENC_KEY_INFO = "alabs-connect/2fa-secret-encryption/v1";
export const WEBAUTHN_CHALLENGE_KEY_INFO = "alabs-connect/webauthn-challenge/v1";
