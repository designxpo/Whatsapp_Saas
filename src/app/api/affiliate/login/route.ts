import { NextResponse } from "next/server";
import { verifyAffiliateLogin } from "@/lib/affiliates";
import { createAffiliateSession, AFFILIATE_SESSION_COOKIE } from "@/lib/auth";
import { loginKey, accountKey, loginThrottleBoth, recordLoginFailure, clearLoginFailures, lockedMessage } from "@/lib/loginthrottle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  // Brute-force throttle, same as the workspace login: per IP + email, and per
  // email across every address. Prefixed so an affiliate's failures never lock
  // a workspace account that happens to share the address, or the reverse.
  const key = loginKey(req, `affiliate:${email}`);
  const acct = accountKey(`affiliate:${email}`);
  const gate = await loginThrottleBoth(key, acct);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: lockedMessage(gate.retryAfterSec) },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } },
    );
  }

  const affiliate = await verifyAffiliateLogin(email, password);
  if (!affiliate) {
    await recordLoginFailure(key, acct);
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }
  await clearLoginFailures(key, acct);
  if (affiliate.status !== "active") return NextResponse.json({ error: "This affiliate account is suspended — contact support." }, { status: 403 });

  const token = await createAffiliateSession({ affiliateId: affiliate.id, email: affiliate.email, name: affiliate.name });
  const res = NextResponse.json({ success: true });
  res.cookies.set(AFFILIATE_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
