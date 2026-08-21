import { NextResponse } from "next/server";
import { verifyAffiliateLogin } from "@/lib/affiliates";
import { createAffiliateSession, AFFILIATE_SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return NextResponse.json({ error: "Email and password are required" }, { status: 400 });

  const affiliate = await verifyAffiliateLogin(email, password);
  if (!affiliate) return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  if (affiliate.status !== "active") return NextResponse.json({ error: "This affiliate account is suspended — contact support." }, { status: 403 });

  const token = await createAffiliateSession({ affiliateId: affiliate.id, email: affiliate.email, name: affiliate.name });
  const res = NextResponse.json({ success: true });
  res.cookies.set(AFFILIATE_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
