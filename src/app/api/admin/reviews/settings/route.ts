import { NextResponse } from "next/server";
import { setReviewSettings, type ReviewSettings } from "@/lib/reviews";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — update this workspace's review settings: auto-post threshold,
// signature, tone, which topics always wait for approval, and review alerts.
// Anything left out keeps its current value.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  let body: Partial<ReviewSettings>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const settings = await setReviewSettings(tid, {
      autoMinStars: body.autoMinStars,
      signature: body.signature,
      tone: body.tone,
      ...(body.holdFor && typeof body.holdFor === "object" ? { holdFor: body.holdFor } : {}),
      ...(body.alerts && typeof body.alerts === "object" ? { alerts: body.alerts } : {}),
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
