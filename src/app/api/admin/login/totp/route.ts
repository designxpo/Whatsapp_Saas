import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession, verifyPendingToken, SESSION_COOKIE, PENDING_LOGIN_COOKIE, PENDING_TOTP_PURPOSE, type SessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";
import { verifySecondFactor } from "@/lib/twofactor";

type PendingLogin = SessionUser & { purpose: string };

// Completes an authenticator challenge. Accepts a live code or one backup code.
//
// Deliberately does NOT trust the device afterwards, unlike the emailed-code
// path: that shortcut exists to avoid mailing somebody on every sign-in, and
// somebody who enrolled an authenticator did so precisely to be asked each time.
export async function POST(req: Request) {
  let body: { code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const pending = await verifyPendingToken<PendingLogin>((await cookies()).get(PENDING_LOGIN_COOKIE)?.value, PENDING_TOTP_PURPOSE);
  if (!pending) return NextResponse.json({ error: "Your session expired — please log in again." }, { status: 401 });

  // Keyed on the ACCOUNT, from a signed token. loginKey() derives from
  // X-Forwarded-For, which a caller sets freely — survivable when guessing a
  // password, useless against six digits.
  const key = `totp:${pending.email.toLowerCase()}`;
  const gate = await loginThrottle(key);
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many incorrect codes. Try again later." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } });
  }

  const result = await verifySecondFactor(pending.email, body.code ?? "");
  if (result === "bad") {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "That code is not right." }, { status: 401 });
  }
  await clearLoginFailures(key);

  const user: SessionUser = { email: pending.email, name: pending.name, role: pending.role, tenantId: pending.tenantId, tokenVersion: pending.tokenVersion };
  logActivity(user, "auth.login", result === "ok-backup" ? "signed in with a BACKUP CODE" : "signed in with an authenticator");
  const token = await createSession(user);
  const res = NextResponse.json({ success: true, usedBackupCode: result === "ok-backup", user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  res.cookies.delete(PENDING_LOGIN_COOKIE);
  return res;
}
