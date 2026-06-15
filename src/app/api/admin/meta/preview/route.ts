import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { adPreview, generateAdPreviews, getAdsAccountId, getAdsPageId, type CtwaInput, type AdObjective } from "@/lib/ads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?adId= — Meta-rendered preview of an existing ad (iframe HTML).
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const adId = new URL(req.url).searchParams.get("adId");
  if (!adId) return NextResponse.json({ error: "adId required" }, { status: 400 });
  const r = await adPreview(adId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ html: r.html });
}

// POST — live previews rendered by Meta from the in-progress creative, across
// every placement, without creating an ad. Powers the builder's preview pane.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: {
    objective?: AdObjective;
    conversionLocation?: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM";
    websiteUrl?: string | null; pixelId?: string | null; conversionEvent?: string | null; leadFormId?: string | null; ctaType?: string | null;
    creative?: CtwaInput["creative"];
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [accountId, pageId] = await Promise.all([getAdsAccountId(tid), getAdsPageId(tid)]);
  if (!accountId) return NextResponse.json({ error: "Connect an ad account first" }, { status: 400 });
  if (!pageId) return NextResponse.json({ error: "Set your Facebook Page ID first" }, { status: 400 });
  if (!body.creative) return NextResponse.json({ error: "No creative" }, { status: 400 });

  const r = await generateAdPreviews({
    accountId, pageId,
    objective: body.objective ?? "OUTCOME_ENGAGEMENT",
    conversionLocation: body.conversionLocation ?? "WHATSAPP",
    websiteUrl: body.websiteUrl ?? null,
    pixelId: body.pixelId ?? null,
    conversionEvent: body.conversionEvent ?? null,
    leadFormId: body.leadFormId ?? null,
    ctaType: body.ctaType ?? null,
    creative: body.creative,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ previews: r.previews });
}
