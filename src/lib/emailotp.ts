// Email OTP — platform auth (login 2FA on new devices, signup email
// verification). Same hash-only + atomic-rate-limit shape as the WhatsApp OTP
// feature (otp.ts / 0076_wa_otp.sql), keyed by email instead of (tenant,
// phone) since login/signup precede tenant resolution. Reuses the generic
// primitives from otp.ts (code generation, constant-time compare, pepper)
// rather than duplicating them — only the hash construction and delivery
// channel (email via Resend, not WhatsApp) differ.
//
// The message itself goes through the shared branded shell (emailtemplate.ts)
// as a proper multipart HTML+text send. A security code that arrives as an
// unbranded HTML-only <div> is the one email we most need people to trust on
// sight, and HTML-only mail also scores worse with spam filters — a code that
// lands in junk reads to the user as a login that's simply broken.

import { createHash } from "crypto";
import { db } from "./supabase";
import { newOtpCode, safeEqual, otpPepper } from "./otp";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";

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

/** Subject line plus both MIME parts of one OTP email. */
export interface OtpEmailContent { subject: string; html: string; text: string }

// Exported as the seam the rendering tests drive: composing the email touches no
// DB and no Resend, so the copy can be asserted without standing either up.
//
// The two purposes are written out separately rather than parameterised over one
// paragraph, because they answer different questions and the "if this wasn't
// you" advice differs: an unwanted signup code means nothing exists yet and
// ignoring it is the whole fix, while an unwanted sign-in code means someone
// else already has the password.
export function composeOtpEmail(purpose: EmailOtpPurpose, code: string): OtpEmailContent {
  // Typed rather than inferred so the branch that has no `secondary` link and
  // the branch that does are still one shape at the render call below.
  const copy: {
    subject: string;
    heading: string;
    paragraphs: string[];
    secondary?: { label: string; href: string };
    footerReason: string;
  } = purpose === "signup"
    ? {
        subject: "Verify your email — Talko AI",
        heading: "Confirm your email address",
        paragraphs: [
          "You're one step away from your Talko AI workspace. Enter the code below on the signup page you still have open to confirm this email address is yours.",
          "Nothing has been created yet — the workspace only gets set up once the code goes in. If you didn't start a signup, ignore this email and no account will ever exist under this address.",
        ],
        footerReason: "You're getting this because this address was entered on the Talko AI signup page. It's a one-time verification code, not a mailing list, so there's nothing here to unsubscribe from.",
      }
    : {
        subject: "Your Talko AI sign-in code",
        heading: "Confirm it's you signing in",
        paragraphs: [
          "Your password was accepted on a device or browser we don't recognise, so we're checking it's really you before opening the workspace. Enter the code below on the sign-in page to finish.",
          "If that wasn't you, don't enter it: the sign-in can't complete without this code, so ignoring this email is enough to stop it. Someone else knowing your password is still worth telling us about though — the link below reaches a human who can lock the account down.",
        ],
        // The one link a security email earns: a way to report the attempt, not
        // an action that completes it. It's `secondary` (a plain link) rather
        // than a CTA button so it can't be mistaken for "click here to sign in",
        // and it's on this purpose only — an unwanted signup code needs nobody.
        secondary: { label: "Report this sign-in", href: "/contact" },
        footerReason: "You're getting this because someone signed in to a Talko AI account with this email address from a device we didn't recognise. It's sent only when that happens — there's nothing recurring to unsubscribe from.",
      };

  const { html, text } = renderEmail({
    // The code in the preview line so it can be read from the notification
    // without opening anything. It stays out of the plain-text part (the shell
    // builds that from the other fields), which keeps the code appearing exactly
    // once there — no ambiguity about which four digits to type.
    preheader: `${code} is your Talko AI code — good for ${EMAIL_OTP_EXPIRY_MINUTES} minutes.`,
    heading: copy.heading,
    paragraphs: copy.paragraphs,
    codeBlock: { code, caption: `This code expires in ${EMAIL_OTP_EXPIRY_MINUTES} minutes and can only be used once.` },
    // The one line an OTP email has to carry: code phishing works by asking the
    // victim to read the digits out, so say plainly that nobody legitimate will.
    highlight: "Talko AI will never ask you for this code — not by email, phone, WhatsApp or chat. Anyone who does is trying to get into your account.",
    // Deliberately no CTA. The code is typed back into the tab that asked for
    // it, so any button here would point at a page that can't consume it — and
    // "click this link to verify" is the exact shape of the phishing mail we're
    // teaching people to distrust two paragraphs above. The login variant's
    // report link is the only concession, and it never signs anyone in.
    ...(copy.secondary ? { secondary: copy.secondary } : {}),
    footerReason: copy.footerReason,
  }, SITE_URL);

  return { subject: copy.subject, html, text };
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

  const mail = composeOtpEmail(purpose, code);
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, type: "otp" });
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
