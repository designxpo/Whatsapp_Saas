// Forgotten password, by emailed code.
//
// The channel is email, not WhatsApp, and that is a deliberate difference from
// the internal portal. The WhatsApp OTP service here is a TENANT'S
// customer-facing product: gated on accountCanSend, needing their own connected
// WABA and an approved template. Platform sign-in cannot depend on whether a
// customer has finished onboarding a number, and must not spend their messaging
// quota on our authentication. Email is already a proven channel for this
// account — it is how new-device sign-in is challenged — so it is reused here.
//
// WHAT THIS DELIBERATELY DOES NOT DO: hand out a session. A verified code lets
// someone set a new password; if they have an authenticator or a passkey, they
// still meet it at sign-in. Otherwise control of a mailbox would be control of
// the account, and the second factor would be worth nothing.

import { db } from "./supabase";
import { hashPassword } from "./team";
import { sendEmailOtp, verifyEmailOtp } from "./emailotp";
import { isPlatformOwnerEmail } from "./auth";

export const MIN_PASSWORD_LENGTH = 10;

const key = (email: string) => email.trim().toLowerCase();

/**
 * Is there a password in the database for this address at all?
 *
 * The platform owner's lives in ADMIN_PASSWORD_HASH, where nothing here can
 * write it, so a reset would appear to work and change nothing. A deactivated
 * member is equally not resettable: someone whose access was withdrawn must not
 * be able to let themselves back in.
 */
async function resettableUser(email: string): Promise<{ id: string; tokenVersion: number } | null> {
  if (isPlatformOwnerEmail(email)) return null;
  const { data } = await db().from("wa_users").select("id, token_version, active").eq("email", key(email)).maybeSingle();
  if (!data || (data.active as boolean) === false) return null;
  return { id: data.id as string, tokenVersion: (data.token_version as number) ?? 0 };
}

/**
 * Send a reset code, if this address can actually be reset.
 *
 * Returns nothing the caller can branch on. Every outcome — unknown address,
 * the owner account, a deactivated member, a code genuinely sent — has to look
 * identical from outside, or this becomes a way to discover who has an account
 * here. The per-address cooldown and daily cap inside sendEmailOtp still bound
 * how much mail one person can be made to receive.
 */
export async function sendResetCode(email: string): Promise<void> {
  if (!(await resettableUser(email))) return;
  await sendEmailOtp(key(email), "reset").catch(() => undefined);
}

export type ResetOutcome = "ok" | "bad-code" | "weak-password" | "no-account";

/**
 * Spend the code and set the new password. Bumps token_version, so every
 * session that existed before the reset dies with it — if the reason for
 * resetting was that somebody else had the password, leaving their session
 * alive would make the whole exercise pointless.
 */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<ResetOutcome> {
  if ((newPassword ?? "").trim().length < MIN_PASSWORD_LENGTH) return "weak-password";

  const user = await resettableUser(email);
  if (!user) return "no-account";

  const v = await verifyEmailOtp(key(email), "reset", code);
  if (!v.ok) return "bad-code";

  const { error } = await db().from("wa_users").update({
    password_hash: hashPassword(newPassword.trim()),
    token_version: user.tokenVersion + 1,
  }).eq("id", user.id);
  if (error) throw new Error(error.message);
  return "ok";
}
