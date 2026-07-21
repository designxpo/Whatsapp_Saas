// Email OTP — platform auth (login 2FA on new devices, signup email
// verification). Same hash-only + atomic-rate-limit shape as the WhatsApp OTP
// feature (otp.ts / 0076_wa_otp.sql), keyed by email instead of (tenant,
// phone) since login/signup precede tenant resolution. Reuses the generic
// primitives from otp.ts (code generation, constant-time compare, pepper)
// rather than duplicating them — only the hash construction and delivery
// channel (email via Resend, not WhatsApp) differ.

import { createHash } from "crypto";
import { db } from "./supabase";
import { newOtpCode, safeEqual, otpPepper } from "./otp";
import { sendEmail } from "./email";

export const EMAIL_OTP_COOLDOWN_SECONDS = 45;   // min gap between sends to one email
export const EMAIL_OTP_DAILY_CAP = 10;          // sends per email per calendar day
export const EMAIL_OTP_MAX_ATTEMPTS = 5;        // wrong guesses before the code dies
export const EMAIL_OTP_EXPIRY_MINUTES = 10;

export type EmailOtpPurpose = "login" | "signup";

// The secret peppers the hash (same pepper as the WhatsApp OTP feature — see
// otpPepper()), and email+purpose are folded in so a code is bound to both
// (a leaked login code can't be replayed as a signup code, etc).
export function hashEmailOtp(email: string, purpose: string, code: string, secret: string): string {
  return createHash("sha256").update(`${email}:${purpose}:${code}:${secret}`).digest("hex");
}

// Maps a Postgres/PostgREST "object missing" error to the apply-migration hint.
function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";  // table / function / not-in-cache
}

function subjectFor(purpose: EmailOtpPurpose): string {
  return purpose === "signup" ? "Verify your email — Talko AI" : "Your Talko AI sign-in code";
}

function htmlFor(purpose: EmailOtpPurpose, code: string): string {
  const intro = purpose === "signup" ? "Enter this code to verify your email and finish creating your account." : "Enter this code to finish signing in on this new device.";
  return `<div style="font-family:sans-serif;font-size:15px;color:#111">
    <p>${intro}</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
    <p style="color:#666">This code expires in ${EMAIL_OTP_EXPIRY_MINUTES} minutes. If you didn't request this, you can safely ignore this email.</p>
  </div>`;
}

export interface SendOtpResult { ok: boolean; error?: string; retryAfterSeconds?: number }

// Generate + store + email one OTP. The cooldown + daily cap are enforced by
// the email_otp_reserve_send DB function under a row lock, so concurrent
// bursts can't bypass them. The plaintext code lives only in this stack frame.
export async function sendEmailOtp(rawEmail: string, purpose: EmailOtpPurpose): Promise<SendOtpResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { ok: false, error: "email required" };

  const now = new Date();
  const code = newOtpCode();
  let gate: { allowed?: boolean; retry_after?: number; reason?: string } | undefined;
  try {
    const { data, error } = await db().rpc("email_otp_reserve_send", {
      p_email: email,
      p_purpose: purpose,
      p_hash: hashEmailOtp(email, purpose, code, otpPepper()),
      p_expires: new Date(now.getTime() + EMAIL_OTP_EXPIRY_MINUTES * 60_000).toISOString(),
      p_cooldown_s: EMAIL_OTP_COOLDOWN_SECONDS,
      p_daily_cap: EMAIL_OTP_DAILY_CAP,
      p_now: now.toISOString(),
    });
    if (error) throw error;
    gate = Array.isArray(data) ? data[0] : data;
  } catch (err) {
    if (isMissingObject(err)) return { ok: false, error: "OTP store not ready — apply migration 0080_email_otp.sql" };
    return { ok: false, error: "OTP store unavailable" };
  }

  if (!gate?.allowed) {
    if (gate?.reason === "cooldown") return { ok: false, error: `Please wait ${gate.retry_after}s before requesting another code`, retryAfterSeconds: gate.retry_after };
    if (gate?.reason === "daily_cap") return { ok: false, error: "Daily code limit reached — try again tomorrow" };
    return { ok: false, error: "Code request not allowed right now" };
  }

  const sent = await sendEmail({ to: email, subject: subjectFor(purpose), html: htmlFor(purpose, code) });
  if (!sent.ok) return { ok: false, error: sent.error || "Failed to send email" };
  return { ok: true };
}

export interface VerifyOtpResult { ok: boolean; error?: string }

// Check a submitted code. email_otp_claim_attempt atomically checks expiry +
// the attempt cap and increments attempts under a row lock BEFORE we compare,
// so concurrent verifies can't test more than EMAIL_OTP_MAX_ATTEMPTS guesses.
// The hash comparison stays here and is constant-time. Single-use: a match
// consumes (blanks) the code.
export async function verifyEmailOtp(rawEmail: string, purpose: EmailOtpPurpose, rawCode: string): Promise<VerifyOtpResult> {
  const email = rawEmail.trim().toLowerCase();
  const code = (rawCode || "").trim();
  if (!email || !/^\d{4}$/.test(code)) return { ok: false, error: "Enter the 4-digit code" };

  let claim: { ok?: boolean; out_hash?: string; reason?: string } | undefined;
  try {
    const { data, error } = await db().rpc("email_otp_claim_attempt", {
      p_email: email, p_purpose: purpose, p_max: EMAIL_OTP_MAX_ATTEMPTS, p_now: new Date().toISOString(),
    });
    if (error) throw error;
    claim = Array.isArray(data) ? data[0] : data;
  } catch {
    return { ok: false, error: "OTP store unavailable" };
  }

  if (!claim?.ok) {
    const reason = claim?.reason;
    if (reason === "expired") return { ok: false, error: "Code expired — request a new one" };
    if (reason === "too_many_attempts") return { ok: false, error: "Too many attempts — request a new code" };
    return { ok: false, error: "No active code — request a new one" };
  }

  const match = safeEqual(hashEmailOtp(email, purpose, code, otpPepper()), claim.out_hash ?? "");
  if (!match) return { ok: false, error: "Incorrect code" };

  await db().rpc("email_otp_consume", { p_email: email, p_purpose: purpose }).then(undefined, () => undefined);
  return { ok: true };
}
