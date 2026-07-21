import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, verifyPendingToken, SESSION_COOKIE, PENDING_LOGIN_COOKIE, PENDING_LOGIN_PURPOSE, type SessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { sendEmailOtp, verifyEmailOtp } from "@/lib/emailotp";
import { isTrustedDevice, trustDevice, newDeviceToken, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE } from "@/lib/devices";

type PendingLogin = SessionUser & { purpose: string };

// POST — completes the login-OTP challenge started by /api/admin/login.
//   { code: string }     verify the code and finish signing in
//   { resend: true }     re-send a code for the same pending login
export async function POST(req: Request) {
  let body: { code?: string; resend?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const jar = await cookies();
  const pendingToken = jar.get(PENDING_LOGIN_COOKIE)?.value;
  const pending = await verifyPendingToken<PendingLogin>(pendingToken, PENDING_LOGIN_PURPOSE);
  if (!pending) return NextResponse.json({ error: "Your session expired — please log in again." }, { status: 401 });

  if (body.resend) {
    const sent = await sendEmailOtp(pending.email, "login");
    if (!sent.ok) return NextResponse.json({ error: sent.error || "Could not send verification code" }, { status: 502 });
    return NextResponse.json({ sent: true });
  }

  const code = (body.code ?? "").trim();
  const verified = await verifyEmailOtp(pending.email, "login", code);
  if (!verified.ok) return NextResponse.json({ error: verified.error || "Incorrect code" }, { status: 400 });

  const user: SessionUser = { email: pending.email, name: pending.name, role: pending.role, tenantId: pending.tenantId, tokenVersion: pending.tokenVersion };

  // Trust this device (best-effort — skip only if already trusted from a race).
  const existing = jar.get(DEVICE_COOKIE)?.value;
  const deviceToken = (await isTrustedDevice(user.email, existing)) ? existing! : newDeviceToken();
  await trustDevice(user.email, deviceToken);

  logActivity(user, "auth.login", "signed in (new device verified)");
  const token = await createSession(user);
  const res = NextResponse.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  res.cookies.set(DEVICE_COOKIE, deviceToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE });
  res.cookies.delete(PENDING_LOGIN_COOKIE);
  return res;
}
