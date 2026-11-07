import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getVerificationDetails, PayoutError } from "@/lib/affiliate-payouts";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { affiliateId }: full UPI ID / bank details of an UNVERIFIED payout
// account, so the owner can send Rs 1 and check the name before verifying.
// Refused once verified. POST (not GET) so details never land in a URL or
// cache. Owner only; every view is audited by the library.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const affiliateId = body.affiliateId;
  if (typeof affiliateId !== "string" || !/^[0-9a-f-]{36}$/i.test(affiliateId)) return NextResponse.json({ error: "affiliateId is required" }, { status: 400 });
  const actor = (await currentUser())?.email ?? "owner";
  try {
    const details = await getVerificationDetails(affiliateId, actor);
    return NextResponse.json({ details }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: err instanceof PayoutError ? 400 : 500 });
  }
}
