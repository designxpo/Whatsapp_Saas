// Authenticator-app second factor.
//
// An OPTIONAL upgrade here, unlike the internal portal where it is mandatory.
// Sign-in already challenges an unrecognised device with an emailed code;
// anyone who enrols is challenged with their authenticator INSTEAD — stronger
// (nothing sitting in a mailbox to intercept) and quicker. Forcing every
// customer through enrolment would buy little on top of the email challenge and
// cost a support queue.
//
// Rows are keyed by email, which is global-unique here (0020) and is how login
// resolves an account before it knows a tenant. The env owner account has no
// wa_users row at all, so anything keyed by user id would leave the most
// privileged login the one that could not be protected.
//
// WHEN THE TABLE IS MISSING this degrades to "nobody has enrolled", so
// deploying ahead of migration 0117 leaves sign-in exactly as it was — password
// plus the emailed new-device code — rather than bricking it.
//
// EVERY OTHER database error fails CLOSED. Treating an unreadable table the
// same way as an absent one would mean anyone who could provoke a transient
// error — or simply catch the database mid-blip — got in on a password alone,
// which is precisely the property 2FA is supposed to remove. A missing table is
// a deployment step; a failing table is an incident, and an incident must not
// quietly downgrade the second factor.

import { createCipheriv, createDecipheriv, randomBytes, randomInt } from "crypto";
import { db } from "./supabase";
import { hashPassword, verifyPassword } from "./team";
import { deriveKey, TOTP_ENC_KEY_INFO } from "./keys";
import { generateSecret, provisioningUri, verifyTotp } from "./totp";

const BACKUP_CODE_COUNT = 10;
// No I/O/0/1 — these are read off a screen and typed back by hand, sometimes
// from a photo or a printout.
const BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", deriveKey(TOTP_ENC_KEY_INFO), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unrecognised 2FA secret format");
  const d = createDecipheriv("aes-256-gcm", deriveKey(TOTP_ENC_KEY_INFO), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function generateBackupCodes(n = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const raw = Array.from({ length: 8 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

// People type these back with or without the dash, in either case.
export function normaliseBackupCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const key = (email: string) => email.trim().toLowerCase();

interface Row {
  email: string;
  secret: string;
  confirmed_at: string | null;
  backup_codes: string[];
  last_step: number;
}

// The specific codes Postgres and PostgREST use for "this table does not exist",
// as opposed to "this table would not answer just now".
const TABLE_MISSING = new Set(["42P01", "PGRST205", "PGRST106"]);

async function readRow(email: string): Promise<{ row: Row | null; available: boolean }> {
  const { data, error } = await db().from("wa_user_2fa").select("*").eq("email", key(email)).maybeSingle();
  if (error) {
    if (TABLE_MISSING.has(error.code)) return { row: null, available: false };
    throw new Error(`two-factor lookup failed: ${error.message}`);
  }
  return { row: (data as Row | null) ?? null, available: true };
}

export interface TwoFactorStatus {
  /** False when migration 0117 has not been applied — nobody can enrol. */
  available: boolean;
  /** Enrolment finished and proven with a real code. */
  enrolled: boolean;
  backupRemaining: number;
}

export async function twoFactorStatus(email: string): Promise<TwoFactorStatus> {
  const { row, available } = await readRow(email);
  return {
    available,
    enrolled: !!row?.confirmed_at,
    backupRemaining: row?.backup_codes?.length ?? 0,
  };
}

/**
 * Start (or restart) enrolment. Overwrites any UNCONFIRMED secret so an
 * abandoned attempt — a closed tab, a phone that never scanned — can simply be
 * retried. A confirmed enrolment is never silently replaced: changing the
 * second factor of an already-protected account goes through resetTwoFactor,
 * which is an admin action and is logged.
 */
export async function beginEnrolment(email: string, accountLabel = email): Promise<{ secret: string; uri: string }> {
  const e = key(email);
  const { row, available } = await readRow(e);
  if (!available) throw new Error("Two-factor storage is unavailable — apply migration 0117_signin_security.sql");
  if (row?.confirmed_at) throw new Error("This account already has two-factor authentication set up");

  const secret = generateSecret();
  const { error } = await db().from("wa_user_2fa").upsert({
    email: e,
    secret: encryptSecret(secret),
    confirmed_at: null,
    backup_codes: [],
    last_step: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "email" });
  if (error) throw new Error(error.message);
  return { secret, uri: provisioningUri(secret, accountLabel) };
}

/**
 * Prove the authenticator actually works before the account is locked behind
 * it, then hand back the backup codes ONCE. Storing only hashes means a
 * database reader cannot use them, and it also means they genuinely cannot be
 * shown again later.
 */
export async function confirmEnrolment(email: string, code: string): Promise<{ ok: boolean; backupCodes?: string[] }> {
  const e = key(email);
  const { row, available } = await readRow(e);
  if (!available || !row) return { ok: false };
  if (row.confirmed_at) return { ok: false };

  const check = verifyTotp(decryptSecret(row.secret), code, { minStep: row.last_step });
  if (!check.ok) return { ok: false };

  const backupCodes = generateBackupCodes();
  const { error } = await db().from("wa_user_2fa").update({
    confirmed_at: new Date().toISOString(),
    backup_codes: backupCodes.map(c => hashPassword(normaliseBackupCode(c))),
    last_step: check.step,
    updated_at: new Date().toISOString(),
  }).eq("email", e);
  if (error) throw new Error(error.message);
  return { ok: true, backupCodes };
}

export type SecondFactorResult = "ok" | "ok-backup" | "bad";

/**
 * Accepts either a live authenticator code or one unused backup code. A spent
 * TOTP step and a spent backup code are both burned on success, so neither can
 * be presented twice.
 */
export async function verifySecondFactor(email: string, code: string): Promise<SecondFactorResult> {
  const e = key(email);
  const { row, available } = await readRow(e);
  if (!available || !row?.confirmed_at) return "bad";

  const totp = verifyTotp(decryptSecret(row.secret), code, { minStep: row.last_step });
  if (totp.ok) {
    await db().from("wa_user_2fa").update({ last_step: totp.step, updated_at: new Date().toISOString() }).eq("email", e);
    return "ok";
  }

  const candidate = normaliseBackupCode(code);
  const stored = row.backup_codes ?? [];
  const hit = stored.findIndex(h => verifyPassword(candidate, h));
  if (hit >= 0) {
    const remaining = stored.filter((_, i) => i !== hit);
    await db().from("wa_user_2fa").update({ backup_codes: remaining, updated_at: new Date().toISOString() }).eq("email", e);
    return "ok-backup";
  }
  return "bad";
}

/** Clears enrolment so the account re-enrols at its next login (lost phone). */
export async function resetTwoFactor(email: string): Promise<void> {
  const { error } = await db().from("wa_user_2fa").delete().eq("email", key(email));
  if (error) throw new Error(error.message);
}

/** Which accounts are actually covered — the answer to "is everyone on 2FA yet?". */
export async function enrolledEmails(): Promise<Set<string>> {
  try {
    const { data, error } = await db().from("wa_user_2fa").select("email, confirmed_at");
    if (error) throw error;
    return new Set((data ?? []).filter((r: { confirmed_at: string | null }) => r.confirmed_at).map((r: { email: string }) => r.email));
  } catch {
    return new Set();
  }
}
