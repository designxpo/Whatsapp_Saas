import { NextResponse } from "next/server";
import { createTenantFromSignup } from "@/lib/tenants";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { getFlag } from "@/lib/flags";
import { loginKey, loginThrottle, recordLoginFailure } from "@/lib/loginthrottle";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST — public self-serve signup. Creates a trialing tenant + its first admin
// user, then signs them in. Captures who's using the platform.
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
  let body: { company?: string; ownerName?: string; ownerEmail?: string; password?: string; ownerPhone?: string; industry?: string; teamSize?: string; useCase?: string; expectedVolume?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const company = body.company?.trim();
  const ownerName = body.ownerName?.trim();
  const ownerEmail = body.ownerEmail?.trim();
  const password = body.password ?? "";
  if (!company || !ownerName || !ownerEmail) return NextResponse.json({ error: "Company, your name and work email are required" }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return NextResponse.json({ error: "Enter a valid work email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters" }, { status: 400 });

  try {
    const { tenantId, email } = await createTenantFromSignup({
      company, ownerName, ownerEmail, password,
      ownerPhone: body.ownerPhone?.trim(), industry: body.industry?.trim(),
      teamSize: body.teamSize?.trim(), useCase: body.useCase?.trim(), expectedVolume: body.expectedVolume?.trim(),
    });
    const token = await createSession({ email, name: ownerName, role: "admin", tenantId });
    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
