import { NextResponse } from "next/server";
import { currentAffiliate } from "@/lib/auth";
import { getAffiliate, verifyAffiliateLogin } from "@/lib/affiliates";
import { getPayoutAccountStatus, setPayoutDetails, payoutMode, PayoutError } from "@/lib/affiliate-payouts";
import { razorpayxConfigured } from "@/lib/razorpayx";
import { loginThrottle, recordLoginFailure, lockedMessage, type ThrottleLimits } from "@/lib/loginthrottle";

export const dynamic = "force-dynamic";

// Per affiliate: 5 wrong passwords in 15 min locks this endpoint for 15 min.
const PASSWORD_LIMITS: ThrottleLimits = { maxFails: 5, windowMin: 15, lockMin: 15 };
// Per affiliate: at most 3 accepted changes a day (each one is a security email, and a RazorpayX call in that mode).
const CHANGE_LIMITS: ThrottleLimits = { maxFails: 3, windowMin: 1440, lockMin: 1440 };

// GET: masked info + status only. The stored details are never returned.
export async function GET() {
  const me = await currentAffiliate();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ account: await getPayoutAccountStatus(me.affiliateId) });
}

export async function POST(req: Request) {
  const me = await currentAffiliate();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { kind?: string; vpa?: unknown; accountNumber?: unknown; ifsc?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.password !== "string" || !body.password) return NextResponse.json({ error: "Enter your password to change payout details" }, { status: 400 });

  // Manual mode (RazorpayX not set up) stores the details for the owner to pay by hand;
  // only a forced RazorpayX mode without its config is refused.
  if (payoutMode() === "razorpayx" && !razorpayxConfigured()) return NextResponse.json({ error: "Payouts are not set up yet. Please try again later." }, { status: 503 });

  const pwKey = `affpayout-pw:${me.affiliateId}`, chgKey = `affpayout-chg:${me.affiliateId}`;
  const [pw, chg] = await Promise.all([loginThrottle(pwKey, PASSWORD_LIMITS), loginThrottle(chgKey, CHANGE_LIMITS)]);
  if (!pw.allowed) return NextResponse.json({ error: lockedMessage(pw.retryAfterSec) }, { status: 429, headers: { "Retry-After": String(pw.retryAfterSec ?? 900) } });
  if (!chg.allowed) return NextResponse.json({ error: "Too many payout account changes today. Try again tomorrow." }, { status: 429, headers: { "Retry-After": String(chg.retryAfterSec ?? 3600) } });

  // Re-verify the password against the stored email, not just the session cookie.
  const aff = await getAffiliate(me.affiliateId);
  if (!aff) return NextResponse.json({ error: "Affiliate account not found" }, { status: 404 });
  if (!(await verifyAffiliateLogin(aff.email, body.password))) {
    await recordLoginFailure(pwKey);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  try {
    const input = body.kind === "upi" ? { kind: "upi" as const, vpa: body.vpa }
      : body.kind === "bank" ? { kind: "bank" as const, accountNumber: body.accountNumber, ifsc: body.ifsc }
        : null;
    if (!input) return NextResponse.json({ error: "Choose UPI or bank account" }, { status: 400 });
    await recordLoginFailure(chgKey);   // counts this attempt toward the daily change limit
    return NextResponse.json({ account: await setPayoutDetails(me.affiliateId, input) });
  } catch (err) {
    if (err instanceof PayoutError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(JSON.stringify({ at: "affiliate.payoutDetails", affiliateId: me.affiliateId, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json({ error: "Could not save payout details right now. Try again shortly." }, { status: 502 });
  }
}
