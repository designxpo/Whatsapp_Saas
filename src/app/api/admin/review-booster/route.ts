import { NextResponse } from "next/server";
import { isPlatformOwner, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getBoosterConfig, saveBoosterConfig, boosterStats, requestReview, reviewBoosterAllowed } from "@/lib/review-booster";
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
    return NextResponse.json({ config: await getBoosterConfig(tid), stats: await boosterStats(tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { enabled, reviewUrl, message, delayHours } — save; { sendTo: phone } —
// ask one customer now (inside their 24-hour WhatsApp window).
export async function POST(req: Request) {
  const tid = await gate();
  if (!tid) return notFound();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (typeof body.sendTo === "string") {
      const phone = body.sendTo.replace(/\D/g, "");
      if (phone.length < 10) return NextResponse.json({ error: "Enter the customer's WhatsApp number with country code." }, { status: 400 });
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
