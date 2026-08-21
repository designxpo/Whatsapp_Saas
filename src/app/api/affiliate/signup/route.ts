import { NextResponse } from "next/server";
import { enrollAffiliate } from "@/lib/affiliates";
import { createAffiliateSession, AFFILIATE_SESSION_COOKIE } from "@/lib/auth";
import { checkEmail } from "@/lib/emailcheck";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — public affiliate enrollment. No Talko tenant required.
export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  const emailQ = checkEmail(email);
  if (!emailQ.ok) return NextResponse.json({ error: "Enter a valid email", ...(emailQ.suggestion ? { suggestion: emailQ.suggestion } : {}) }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters" }, { status: 400 });

  try {
    const affiliate = await enrollAffiliate({ name, email, password, phone: body.phone });
    const token = await createAffiliateSession({ affiliateId: affiliate.id, email: affiliate.email, name: affiliate.name });
    const res = NextResponse.json({ success: true, code: affiliate.code });
    res.cookies.set(AFFILIATE_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
