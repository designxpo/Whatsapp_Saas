import { NextResponse } from "next/server";
import { enrollAffiliate } from "@/lib/affiliates";
import { createAffiliateSession, AFFILIATE_SESSION_COOKIE } from "@/lib/auth";
import { checkEmail } from "@/lib/emailcheck";
import { errorMessage } from "@/lib/errors";
import { ownerAudit } from "@/lib/tenants";
import { LEGAL_VERSION } from "@/app/(site)/_content/legal";
import { rateLimit, clientIp, type Limit } from "@/lib/ratelimit";
import { isReservedEmail, RESERVED_EMAIL_MESSAGE } from "@/lib/reserved-email";

export const dynamic = "force-dynamic";

// Enrollments per address. A real person enrolls once (twice after a typo);
// without a cap this public endpoint creates accounts — and runs a scrypt hash
// per request — as fast as a script can post.
const AFFILIATE_SIGNUP_PER_IP: Limit = { limit: 5, windowSec: 900 };

// POST — public affiliate enrollment. No Talko tenant required.
export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string; phone?: string; acceptTerms?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Counted after the body parses, so a malformed flood can't spend an honest
  // caller's allowance (same order as /api/contact).
  const rl = await rateLimit(`affiliate-signup:${clientIp(req)}`, AFFILIATE_SIGNUP_PER_IP);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many sign-ups from this network. Please try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!name || !email) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  const emailQ = checkEmail(email);
  if (!emailQ.ok) return NextResponse.json({ error: "Enter a valid email", ...(emailQ.suggestion ? { suggestion: emailQ.suggestion } : {}) }, { status: 400 });
  if (isReservedEmail(email)) return NextResponse.json({ error: RESERVED_EMAIL_MESSAGE }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters" }, { status: 400 });
  // Legal consent is mandatory, same as workspace signup — enforced here, not
  // just by the checkbox, so a direct POST can't skip it.
  if (body.acceptTerms !== true) return NextResponse.json({ error: "You must accept the Terms of Service and Privacy Policy to continue." }, { status: 400 });

  try {
    const affiliate = await enrollAffiliate({ name, email, password, phone: body.phone });
    // wa_affiliates has no consent columns, so the acceptance (who, when, which
    // version) goes to the same append-only audit log workspace signup uses.
    // Best-effort, like every ownerAudit write.
    await ownerAudit(affiliate.email, "affiliate.terms_accepted", null, `Accepted Terms of Service & Privacy Policy — version ${LEGAL_VERSION}`);
    const token = await createAffiliateSession({ affiliateId: affiliate.id, email: affiliate.email, name: affiliate.name });
    const res = NextResponse.json({ success: true, code: affiliate.code });
    res.cookies.set(AFFILIATE_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
