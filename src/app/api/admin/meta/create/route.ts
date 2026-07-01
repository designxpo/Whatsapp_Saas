import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdsAccountId, getAdsPageId, createCtwaCampaign, type CtwaInput, type AdObjective, type BidStrategy } from "@/lib/ads";
import { setFlowTrigger } from "@/lib/adflow";
import { recordPortalCampaign } from "@/lib/adsmeta";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — create a full Click-to-WhatsApp campaign (campaign → ad set →
// creative → ad). Admin-only; created PAUSED unless activate=true.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: {
    name?: string; budget?: number; activate?: boolean; campaignId?: string | null;
    objective?: AdObjective; specialAdCategories?: string[];
    conversionLocation?: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM";
    websiteUrl?: string | null; pixelId?: string | null; conversionEvent?: string | null; leadFormId?: string | null; ctaType?: string | null;
    budgetLevel?: "campaign" | "adset"; budgetType?: "daily" | "lifetime";
    startTime?: string | null; endTime?: string | null; bidStrategy?: BidStrategy; bidAmount?: number | null;
    optimizationGoal?: string | null;
    placements?: "advantage" | "manual"; publisherPlatforms?: string[]; positions?: Record<string, string[]>;
    targeting?: CtwaInput["targeting"];
    creative?: CtwaInput["creative"] & { cards?: { imageHash?: string | null; headline: string; description?: string; link?: string }[] };
    creatives?: (CtwaInput["creative"] & { cards?: { imageHash?: string | null; headline: string; description?: string; link?: string }[] })[];
    advantageCreative?: boolean;
    flowId?: string | null; flowScope?: "campaign" | "ad";
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [accountId, pageId] = await Promise.all([getAdsAccountId(tid), getAdsPageId(tid)]);
  if (!accountId) return NextResponse.json({ error: "Connect an ad account first" }, { status: 400 });
  if (!pageId) return NextResponse.json({ error: "Set your Facebook Page ID first (Meta Ads → settings)" }, { status: 400 });
  if (!body.name?.trim()) return NextResponse.json({ error: body.campaignId ? "Give the ad set a name" : "Give the campaign a name" }, { status: 400 });
  // A new campaign always needs a budget; adding an ad set to an EXISTING campaign
  // needs one only when it's ABO (per-ad-set budget). A CBO campaign holds the budget.
  const budgetRequired = !body.campaignId || body.budgetLevel === "adset";
  if (budgetRequired && (!body.budget || body.budget <= 0)) return NextResponse.json({ error: "Set a budget" }, { status: 400 });
  if (body.budgetType === "lifetime" && !body.endTime) return NextResponse.json({ error: "Lifetime budgets need an end date" }, { status: 400 });
  if (body.conversionLocation === "WEBSITE" && !body.websiteUrl?.trim()) return NextResponse.json({ error: "Add the website URL people should land on" }, { status: 400 });
  if (body.conversionLocation === "INSTANT_FORM" && !body.leadFormId) return NextResponse.json({ error: "Pick a lead form (create one in Ads Manager first if none appear)" }, { status: 400 });
  // One or more creatives — each becomes its own ad sharing the ONE ad set.
  const creatives = Array.isArray(body.creatives) && body.creatives.length ? body.creatives : (body.creative ? [body.creative] : []);
  if (!creatives.length) return NextResponse.json({ error: "Add at least one creative" }, { status: 400 });
  for (let i = 0; i < creatives.length; i++) {
    const c = creatives[i];
    const where = creatives.length > 1 ? ` (creative ${i + 1})` : "";
    const fmt = c?.format ?? "single";
    if (!c?.primaryText?.trim()) return NextResponse.json({ error: `Write the ad text${where}` }, { status: 400 });
    // Carousel headlines live per-card, so no ad-level headline is required there.
    if (fmt !== "carousel" && !c?.headline?.trim()) return NextResponse.json({ error: `Write the headline${where}` }, { status: 400 });
    if (fmt === "video" && !c?.videoId) return NextResponse.json({ error: `Upload a video for the video ad${where}` }, { status: 400 });
    if (fmt === "carousel") {
      const cards = c?.cards ?? [];
      if (cards.length < 2) return NextResponse.json({ error: `A carousel needs at least 2 cards${where}` }, { status: 400 });
      if (cards.some(cc => !cc.imageHash || !cc.headline?.trim())) return NextResponse.json({ error: `Each carousel card needs an image and a headline${where}` }, { status: 400 });
    }
  }

  const r = await createCtwaCampaign({
    accountId, pageId,
    campaignId: body.campaignId?.trim() || null,
    name: body.name.trim(),
    objective: body.objective ?? "OUTCOME_ENGAGEMENT",
    specialAdCategories: Array.isArray(body.specialAdCategories) ? body.specialAdCategories : [],
    conversionLocation: body.conversionLocation ?? "WHATSAPP",
    websiteUrl: body.websiteUrl ?? null,
    pixelId: body.pixelId ?? null,
    conversionEvent: body.conversionEvent ?? null,
    leadFormId: body.leadFormId ?? null,
    ctaType: body.ctaType ?? null,
    budgetLevel: body.budgetLevel === "campaign" ? "campaign" : "adset",
    budgetType: body.budgetType === "lifetime" ? "lifetime" : "daily",
    budget: body.budget ?? 0,
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    bidStrategy: body.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
    bidAmount: body.bidAmount ?? null,
    optimizationGoal: body.optimizationGoal ?? undefined,
    placements: body.placements === "manual" ? "manual" : "advantage",
    publisherPlatforms: Array.isArray(body.publisherPlatforms) ? body.publisherPlatforms : [],
    positions: body.positions ?? {},
    targeting: {
      countries: body.targeting?.countries ?? [],
      cities: body.targeting?.cities ?? [],
      regions: body.targeting?.regions ?? [],
      zips: body.targeting?.zips ?? [],
      neighborhoods: body.targeting?.neighborhoods ?? [],
      subcities: body.targeting?.subcities ?? [],
      metros: body.targeting?.metros ?? [],
      geoMarkets: body.targeting?.geoMarkets ?? [],
      customLocations: body.targeting?.customLocations ?? [],
      ageMin: body.targeting?.ageMin ?? 18,
      ageMax: body.targeting?.ageMax ?? 65,
      genders: body.targeting?.genders ?? [],
      interests: body.targeting?.interests ?? [],
      locales: body.targeting?.locales ?? [],
      customAudiences: body.targeting?.customAudiences ?? [],
      excludedCustomAudiences: body.targeting?.excludedCustomAudiences ?? [],
      advantageAudience: body.targeting?.advantageAudience ?? false,
    },
    creative: creatives[0],
    creatives,
    advantageCreative: body.advantageCreative === true,
    activate: body.activate === true,
  });

  if (!r.ok) return NextResponse.json({ error: `Failed at the ${r.stage}: ${r.error}`, campaignId: r.campaignId ?? null }, { status: 502 });

  // Remember this was created from the portal (vs. directly in Ads Manager).
  if (r.campaignId) await recordPortalCampaign(r.campaignId, body.name?.trim(), tid);

  // Auto-start a chatbot flow for leads from this ad — campaign default or this ad.
  if (body.flowId) {
    const scope = body.flowScope === "ad" ? "ad" : "campaign";
    const refId = scope === "ad" ? r.adId : r.campaignId;
    if (refId) await setFlowTrigger({ flowId: body.flowId, scope, refId, label: body.name?.trim(), tenantId: tid }).catch(() => {});
  }

  logActivity(await currentUser(), "ads.create", `${body.name} (${body.activate ? "live" : "paused"})`);
  return NextResponse.json({ success: true, campaignId: r.campaignId, adId: r.adId });
}
