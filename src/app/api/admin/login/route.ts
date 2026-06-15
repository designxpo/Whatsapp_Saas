import { NextResponse } from "next/server";
import { checkCredentials, createSession, SESSION_COOKIE, DEFAULT_TENANT_ID, type SessionUser } from "@/lib/auth";
import { verifyTeamLogin, logActivity } from "@/lib/team";
import { loginKey, loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";

export async function POST(req: Request) {
  let body: { user?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const login = (body.user ?? "").trim();
  const password = body.password ?? "";

  // Brute-force throttle (per IP + username).
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

  logActivity(user, "auth.login", "signed in");
  const token = await createSession(user);
  const res = NextResponse.json({ success: true, user: { email: user.email, name: user.name, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
