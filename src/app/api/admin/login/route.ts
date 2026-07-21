import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkCredentials, createSession, createPendingToken, SESSION_COOKIE, DEFAULT_TENANT_ID, PENDING_LOGIN_COOKIE, PENDING_LOGIN_PURPOSE, type SessionUser } from "@/lib/auth";
import { verifyTeamLogin, logActivity } from "@/lib/team";
import { loginKey, loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";
import { isTrustedDevice, DEVICE_COOKIE } from "@/lib/devices";
import { sendEmailOtp } from "@/lib/emailotp";

// Accounts that skip the new-device email OTP entirely — e.g. a platform
// reviewer test login (Meta App Review, etc.) that must work from an unknown
// browser with no human present to relay an emailed code. Comma-separated,
// case-insensitive. Empty/unset = no exemptions (every account gets 2FA).
function isOtpExempt(email: string): boolean {
  const list = (process.env.LOGIN_OTP_EXEMPT_EMAILS ?? "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function POST(req: Request) {
  let body: { user?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const login = (body.user ?? "").trim();
  const password = body.password ?? "";

  // Brute-force throttle (per IP + username) — unchanged; the OTP step below
  // is additive 2FA, not a replacement for this gate.
  const key = loginKey(req, login);
  const gate = await loginThrottle(key);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } },
    );
  }

  // Owner account (env) first, then team members (wa_users).
  let user: SessionUser | null = null;
  if (checkCredentials(login, password)) {
    user = { email: login, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: Number(process.env.ADMIN_TOKEN_EPOCH ?? "0") || 0 };
  } else {
    const member = await verifyTeamLogin(login, password);
    if (member) user = { email: member.email, name: member.name || member.email, role: member.role, tenantId: member.tenantId, tokenVersion: member.tokenVersion };
  }
  if (!user) {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  await clearLoginFailures(key);

  // Credentials are correct. If this browser has already completed an OTP
  // challenge for this email, sign in immediately as before. Otherwise this is
  // an unrecognized device — challenge with an emailed code before issuing a
  // real session.
  const deviceToken = (await cookies()).get(DEVICE_COOKIE)?.value;
  const trusted = isOtpExempt(user.email) || (await isTrustedDevice(user.email, deviceToken));

  if (!trusted) {
    const sent = await sendEmailOtp(user.email, "login");
    if (!sent.ok) return NextResponse.json({ error: sent.error || "Could not send verification code" }, { status: 502 });

    logActivity(user, "auth.login_otp_sent", "new device — code emailed");
    const pending = await createPendingToken({ email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, tokenVersion: user.tokenVersion }, PENDING_LOGIN_PURPOSE, "10m");
    const res = NextResponse.json({ pending: true, email: user.email });
    res.cookies.set(PENDING_LOGIN_COOKIE, pending, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    return res;
  }

  logActivity(user, "auth.login", "signed in");
  const token = await createSession(user);
  const res = NextResponse.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
