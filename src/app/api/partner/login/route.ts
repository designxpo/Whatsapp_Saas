import { NextResponse } from "next/server";
import { createPartnerSession, PARTNER_SESSION_COOKIE } from "@/lib/auth";
import { verifyPartnerLogin } from "@/lib/partner-portal";
import { brandForHost } from "@/lib/brand-lookup";
import { loginKey, loginThrottle, recordLoginFailure, clearLoginFailures } from "@/lib/loginthrottle";
import { readJson } from "@/lib/partner-api";

export const dynamic = "force-dynamic";

// POST { email, password } — sign in to the partner dashboard on this
// partner's own address. Throttled like the workspace login.
export async function POST(req: Request) {
  const here = (await brandForHost(req.headers.get("host"))).brand;
  if (!here?.partnerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const slug = here.partnerId;
  const body = await readJson<{ email?: string; password?: string }>(req);
  const email = (body?.email ?? "").trim();
  const password = body?.password ?? "";
  if (!email || !password) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });

  const key = loginKey(req, `partner:${slug}:${email}`);
  const gate = await loginThrottle(key);
  if (!gate.allowed) return NextResponse.json({ error: "Too many failed attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec ?? 900) } });

  const ok = await verifyPartnerLogin(here.partnerId, email, password).catch(() => null);
  if (!ok) {
    await recordLoginFailure(key);
    return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
  }
  await clearLoginFailures(key);
  const token = await createPartnerSession({ userId: ok.user.id, partnerId: ok.user.partnerId, email: ok.user.email, tokenVersion: ok.tokenVersion });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PARTNER_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
