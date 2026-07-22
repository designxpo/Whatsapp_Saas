import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { createPendingToken, PENDING_SIGNUP_COOKIE, PENDING_SIGNUP_PURPOSE } from "@/lib/auth";
import { getFlag } from "@/lib/flags";
import { loginKey, loginThrottle, recordLoginFailure } from "@/lib/loginthrottle";
import { sendEmailOtp } from "@/lib/emailotp";
import { encryptSecret } from "@/lib/crypto";
import { errorMessage } from "@/lib/errors";
import { LEGAL_VERSION } from "@/app/(site)/_content/legal";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST — public self-serve signup, step 1. Validates the form and emails a
// verification code; the tenant + admin account are NOT created yet (see
// /api/signup/verify-otp) — this keeps a stray/typo'd email from ever landing
// a real account, and proves the signer owns the inbox before we trust it.
export async function POST(req: Request) {
  // Platform-wide signup kill switch (owner control plane).
  if (!(await getFlag("signups_enabled", true))) {
    return NextResponse.json({ error: "Signups are currently closed. Please check back soon." }, { status: 403 });
  }

  // Abuse throttle — cap signups per IP so the public endpoint can't be used to
  // mass-create tenants. Reuses the login-attempts table (degrades open if absent).
  const throttleKey = loginKey(req, "signup");
  const gate = await loginThrottle(throttleKey);
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many signups from this network. Please try again shortly." }, { status: 429, headers: gate.retryAfterSec ? { "Retry-After": String(gate.retryAfterSec) } : undefined });
  }
  await recordLoginFailure(throttleKey);   // count this attempt toward the cap
  let body: { company?: string; ownerName?: string; ownerEmail?: string; password?: string; ownerPhone?: string; industry?: string; teamSize?: string; useCase?: string; expectedVolume?: string; acceptTerms?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const company = body.company?.trim();
  const ownerName = body.ownerName?.trim();
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!company || !ownerName || !ownerEmail) return NextResponse.json({ error: "Company, your name and work email are required" }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return NextResponse.json({ error: "Enter a valid work email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters" }, { status: 400 });
  // Legal consent is mandatory — the account cannot be created without it.
  if (body.acceptTerms !== true) return NextResponse.json({ error: "You must accept the Terms of Service and Privacy Policy to continue." }, { status: 400 });

  // Fail fast on an email that can never complete signup — no point sending a
  // code (or burning the daily send cap) for an account that already exists.
  const existing = await db().from("wa_users").select("id").eq("email", ownerEmail).maybeSingle();
  if (existing.data) return NextResponse.json({ error: "An account with this email already exists — try logging in." }, { status: 400 });

  const sent = await sendEmailOtp(ownerEmail, "signup");
  // A cooldown rejection means a code was already sent moments ago (e.g. a
  // resubmit right after an earlier attempt) — proceed with the code already
  // in the inbox instead of blocking. Any OTHER failure has no usable code.
  if (!sent.ok && sent.retryAfterSeconds === undefined) {
    return NextResponse.json({ error: sent.error || "Could not send verification code" }, { status: 502 });
  }

  try {
    const pending = await createPendingToken({
      // The pending token is a SIGNED (not encrypted) JWT that rides in a cookie,
      // so its payload is publicly decodable. Never carry the raw password there —
      // encrypt it at rest; verify-otp decrypts just before account creation.
      company, ownerName, ownerEmail, password: encryptSecret(password),
      ownerPhone: body.ownerPhone?.trim(), industry: body.industry?.trim(),
      teamSize: body.teamSize?.trim(), useCase: body.useCase?.trim(), expectedVolume: body.expectedVolume?.trim(),
      termsVersion: LEGAL_VERSION,
    }, PENDING_SIGNUP_PURPOSE, "15m");
    const res = NextResponse.json({ pending: true, email: ownerEmail });
    res.cookies.set(PENDING_SIGNUP_COOKIE, pending, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 900 });
    return res;
  } catch (err) {
    // Unauthenticated endpoint — log detail server-side, return a generic message.
    console.error(JSON.stringify({ at: "signup", error: errorMessage(err) }));
    return NextResponse.json({ error: "Could not start signup — please try again." }, { status: 400 });
  }
}
