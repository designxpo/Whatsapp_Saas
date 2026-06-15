import { NextResponse } from "next/server";
import { campaignFunnel, retargetRecipients, getCampaign, type RetargetSegment } from "@/lib/store";
import { campaignClickStats, campaignRepliedCount, campaignPerDay } from "@/lib/links";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const SEGMENTS: RetargetSegment[] = ["sent_not_delivered", "delivered_not_read", "read", "failed"];

// GET — full stats for one campaign: delivery funnel + clicked/replied counts
// + per-day series + campaign info (AiSensy-style detail page). Passing
// ?segment= additionally returns retargetable recipients for that segment.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const segment = new URL(req.url).searchParams.get("segment") as RetargetSegment | null;
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const campaign = await getCampaign(id, tid);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    if (segment && SEGMENTS.includes(segment)) {
      const [funnel, recipients] = await Promise.all([campaignFunnel(id), retargetRecipients(id, segment, tid)]);
      return NextResponse.json({ funnel, segment, recipients });
    }

    const [funnel, clicks, replied] = await Promise.all([
      campaignFunnel(id),
      campaignClickStats(id),
      campaignRepliedCount(id, campaign.sentAt ?? campaign.createdAt),
    ]);
    const perDay = await campaignPerDay(id, clicks.perDayClicks);
    return NextResponse.json({
      funnel,
      clicked: clicks.clicked,
      replied,
      perDay,
      info: {
        name: campaign.name ?? campaign.templateName,
        templateName: campaign.templateName,
        sentOn: campaign.sentAt ?? campaign.createdAt,
        status: campaign.status,
        totalRecipients: campaign.totalRecipients,
        ctaUrl: clicks.ctaUrl,
        clickTracking: clicks.trackedRecipients > 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
