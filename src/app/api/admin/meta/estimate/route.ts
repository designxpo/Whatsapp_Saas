import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { estimateAudience, getAdsAccountId, getAdsPageId, type CtwaInput, type AdObjective } from "@/lib/ads";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST — Meta audience-size estimate for the in-progress targeting. Powers the
// "Audience definition" panel shown during the audience step of the builder.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: {
    objective?: AdObjective;
    conversionLocation?: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM";
    websiteUrl?: string | null; pixelId?: string | null; conversionEvent?: string | null; leadFormId?: string | null; ctaType?: string | null;
    optimizationGoal?: string | null;
    placements?: "advantage" | "manual"; publisherPlatforms?: string[]; positions?: Record<string, string[]>;
    targeting?: CtwaInput["targeting"];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [accountId, pageId] = await Promise.all([getAdsAccountId(tid), getAdsPageId(tid)]);
  if (!accountId) return NextResponse.json({ error: "Connect an ad account first" }, { status: 400 });
  if (!body.targeting) return NextResponse.json({ error: "No targeting" }, { status: 400 });

  const r = await estimateAudience({
    accountId, pageId: pageId ?? "",
    objective: body.objective ?? "OUTCOME_ENGAGEMENT",
    conversionLocation: body.conversionLocation ?? "WHATSAPP",
    websiteUrl: body.websiteUrl ?? null, pixelId: body.pixelId ?? null, conversionEvent: body.conversionEvent ?? null,
    leadFormId: body.leadFormId ?? null, ctaType: body.ctaType ?? null,
    optimizationGoal: body.optimizationGoal ?? undefined,
    placements: body.placements === "manual" ? "manual" : "advantage",
    publisherPlatforms: Array.isArray(body.publisherPlatforms) ? body.publisherPlatforms : [],
    positions: body.positions ?? {},
    targeting: body.targeting,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ lower: r.lower, upper: r.upper, ready: r.ready });
}
