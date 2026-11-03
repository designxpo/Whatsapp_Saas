import { NextResponse } from "next/server";
import { isPlatformOwner, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getBoosterConfig, saveBoosterConfig, boosterStats, requestReview, reviewBoosterAllowed, connectedGoogleProfile, fillReviewUrlFromGoogle } from "@/lib/review-booster";
import { normalizePhone } from "@/lib/inbound/normalize";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Not live yet: only the platform owner, in their own workspace. Everyone else
// gets a plain 404, so the feature doesn't exist for them at all.
async function gate(): Promise<string | null> {
  if (!(await isPlatformOwner())) return null;
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  return reviewBoosterAllowed(tid) ? tid : null;
}
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

// GET — settings and the last 30 days.
export async function GET() {
  const tid = await gate();
  if (!tid) return notFound();
  try {
    return NextResponse.json({ config: await getBoosterConfig(tid), stats: await boosterStats(tid), googleConnected: !!(await connectedGoogleProfile(tid)) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { enabled, reviewUrl, message, delayHours } — save; { sendTo: phone } —
// ask one customer now (inside their 24-hour WhatsApp window); { fromGoogle:
// true } — fill the link from the connected Business Profile.
export async function POST(req: Request) {
  const tid = await gate();
  if (!tid) return notFound();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (body.fromGoogle === true) {
      const r = await fillReviewUrlFromGoogle(tid);
      return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
    }
    if (typeof body.sendTo === "string") {
      // Chats are stored as WhatsApp addresses them (918368872108); a bare
      // 10-digit Indian number typed here would otherwise never match one.
      const phone = normalizePhone(body.sendTo);
      if (!phone) return NextResponse.json({ error: "Enter the customer's WhatsApp number, e.g. 98XXXXXXXX or +91 98XXXXXXXX." }, { status: 400 });
      return NextResponse.json(await requestReview(tid, phone, null));
    }
    const r = await saveBoosterConfig(tid, {
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(typeof body.reviewUrl === "string" ? { reviewUrl: body.reviewUrl } : {}),
      ...(typeof body.message === "string" ? { message: body.message } : {}),
      ...(body.delayHours !== undefined ? { delayHours: Number(body.delayHours) } : {}),
    });
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
