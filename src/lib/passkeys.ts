// Passkeys (WebAuthn): storage, relying-party config, and the short-lived
// challenge the browser has to sign.
//
// Unlike totp.ts, this one DOES take a dependency. TOTP is an HMAC and a
// modulo with published test vectors; WebAuthn verification is CBOR decoding,
// COSE key parsing and signature checks across ES256/RS256/EdDSA, with
// attestation formats on top. Hand-rolling that would be the kind of
// home-made crypto that turns a second factor into a decoration.

import { SignJWT, jwtVerify } from "jose";
import { db } from "./supabase";
import { deriveKey, WEBAUTHN_CHALLENGE_KEY_INFO } from "./keys";

export const PASSKEY_CHALLENGE_COOKIE = "wa_pk_challenge";

export interface StoredPasskey {
  id: string;
  email: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceName: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

function map(r: Record<string, unknown>): StoredPasskey {
  return {
    id: r.id as string,
    email: r.email as string,
    credentialId: r.credential_id as string,
    publicKey: r.public_key as string,
    counter: Number(r.counter ?? 0),
    transports: (r.transports as string[]) ?? [],
    deviceName: (r.device_name as string) ?? "",
    backedUp: (r.backed_up as boolean) ?? false,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  };
}

// A table that does not exist yet is a deployment step and simply means "no
// passkeys". A table that will not answer is an incident, and must not be
// reported as "this account has no passkeys" — from the caller's side that is
// indistinguishable from a correct answer.
const TABLE_MISSING = new Set(["42P01", "PGRST205", "PGRST106"]);

export interface PasskeyRead { passkeys: StoredPasskey[]; available: boolean }

export async function listPasskeys(email: string): Promise<PasskeyRead> {
  const { data, error } = await db().from("wa_user_passkeys").select("*")
    .eq("email", email.trim().toLowerCase()).order("created_at", { ascending: true });
  if (error) {
    if (TABLE_MISSING.has(error.code)) return { passkeys: [], available: false };
    throw new Error(`passkey lookup failed: ${error.message}`);
  }
  return { passkeys: (data ?? []).map(map), available: true };
}

export async function findByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
  const { data, error } = await db().from("wa_user_passkeys").select("*")
    .eq("credential_id", credentialId).maybeSingle();
  if (error) {
    if (TABLE_MISSING.has(error.code)) return null;
    throw new Error(`passkey lookup failed: ${error.message}`);
  }
  return data ? map(data as Record<string, unknown>) : null;
}

export async function savePasskey(p: {
  email: string; credentialId: string; publicKey: string; counter: number;
  transports: string[]; deviceName: string; backedUp: boolean;
}): Promise<void> {
  const { error } = await db().from("wa_user_passkeys").insert({
    email: p.email.trim().toLowerCase(),
    credential_id: p.credentialId,
    public_key: p.publicKey,
    counter: p.counter,
    transports: p.transports,
    device_name: p.deviceName.slice(0, 80),
    backed_up: p.backedUp,
  });
  if (error) throw new Error(error.message);
}

export async function touchPasskey(credentialId: string, counter: number): Promise<void> {
  await db().from("wa_user_passkeys")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("credential_id", credentialId);
}

export async function deletePasskey(email: string, id: string): Promise<void> {
  // Scoped to the owner's email so one person cannot delete another's key by id.
  const { error } = await db().from("wa_user_passkeys").delete()
    .eq("id", id).eq("email", email.trim().toLowerCase());
  if (error) throw new Error(error.message);
}

// ── Relying party ─────────────────────────────────────────────────────────────
//
// The RP ID is the domain the credential is bound to, and it is what makes a
// passkey unphishable — so it is derived from the request host rather than
// configured loosely, and an env override exists only for deployments behind a
// different public hostname than the one Next sees.
export interface RelyingParty { rpID: string; rpName: string; origin: string }

export function relyingParty(req: Request): RelyingParty {
  const envID = process.env.WEBAUTHN_RP_ID;
  const envOrigin = process.env.WEBAUTHN_ORIGIN;
  if (envID && envOrigin) return { rpID: envID, rpName: "Talko AI", origin: envOrigin };

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const hostname = host.split(":")[0];
  const proto = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
  return { rpID: hostname, rpName: "Talko AI", origin: `${proto}://${host}` };
}

// ── Challenge ─────────────────────────────────────────────────────────────────
//
// Held in a signed, short-lived cookie rather than a database row: it is a
// one-shot nonce, it must be tied to this browser, and a table would need
// sweeping. Signed with its own derived key so it cannot be confused with a
// session or a 2FA ticket.
function challengeKey(): Uint8Array {
  return new Uint8Array(deriveKey(WEBAUTHN_CHALLENGE_KEY_INFO));
}

export async function sealChallenge(challenge: string, purpose: "register" | "login", email?: string): Promise<string> {
  return new SignJWT({ c: challenge, p: purpose, ...(email ? { e: email } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(challengeKey());
}

export async function openChallenge(token: string | undefined, purpose: "register" | "login"): Promise<{ challenge: string; email?: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, challengeKey());
    if (payload.p !== purpose || typeof payload.c !== "string") return null;
    return { challenge: payload.c, email: typeof payload.e === "string" ? payload.e : undefined };
  } catch {
    return null;
  }
}

export const CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 300,
} as const;
