import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import {
  createCampaign, startCampaign, listCampaigns, audienceCount, renderCampaign,
  AUDIENCE_MODES, type AudienceMode, type CampaignMode,
} from "@/lib/ownerbroadcast";
import { sendEmail } from "@/lib/email";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — recent campaigns, plus the live recipient count for each segment so the
// composer can say "this goes to N tenants" before anything is created.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const wantCounts = new URL(req.url).searchParams.get("counts") === "1";
  try {
    const campaigns = await listCampaigns();
    if (!wantCounts) return NextResponse.json({ campaigns });
    const entries = await Promise.all(AUDIENCE_MODES.map(async m => [m, await audienceCount(m)] as const));
    return NextResponse.json({ campaigns, counts: Object.fromEntries(entries) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

interface Body {
  subject?: string; mode?: CampaignMode; heading?: string; paragraphs?: string[];
  imageUrl?: string | null; ctaLabel?: string | null; ctaUrl?: string | null;
  htmlBody?: string; audienceMode?: AudienceMode;
  /** Send one copy to the owner's own address instead of creating a campaign. */
  testOnly?: boolean;
}

// POST — either a test send to the owner (testOnly), or create the campaign and
// arm it. Creating and arming are separate calls inside ownerbroadcast so a
// create that half-fails can't leak a partial blast; this route does both only
// once the create has fully succeeded.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const me = await currentUser();

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const mode: CampaignMode = body.mode === "html" ? "html" : "simple";
  const audienceMode: AudienceMode = AUDIENCE_MODES.includes(body.audienceMode as AudienceMode)
    ? (body.audienceMode as AudienceMode) : "all";

  try {
    // A test send renders exactly what a tenant would get — same renderer, same
    // personalisation path — but goes only to the owner and is never queued.
    if (body.testOnly) {
      if (!me?.email) return NextResponse.json({ error: "No email on your session to send a test to" }, { status: 400 });
      const preview = {
        id: "test", subject: body.subject?.trim() || "(no subject)", mode,
        heading: body.heading?.trim() || null,
        bodyParagraphs: (body.paragraphs ?? []).map(p => p.trim()).filter(Boolean),
        imageUrl: body.imageUrl?.trim() || null,
        ctaLabel: body.ctaLabel?.trim() || null, ctaUrl: body.ctaUrl?.trim() || null,
        htmlBody: body.htmlBody ?? null, audienceMode, status: "draft" as const,
        totalRecipients: 0, sentCount: 0, failedCount: 0, errorSummary: null,
        createdBy: me.email, createdAt: new Date().toISOString(), sentAt: null,
      };
      const { subject, html, text } = renderCampaign(preview, { company: "Example Business", ownerName: me.name || "there" });
      const r = await sendEmail({ to: me.email, subject: `[TEST] ${subject}`, html, text, type: "owner_broadcast" });
      if (!r.ok) return NextResponse.json({ error: r.error || "Test send failed" }, { status: 502 });
      return NextResponse.json({ tested: true, to: me.email });
    }

    const campaign = await createCampaign({
      subject: body.subject ?? "", mode,
      heading: body.heading, paragraphs: body.paragraphs,
      imageUrl: body.imageUrl, ctaLabel: body.ctaLabel, ctaUrl: body.ctaUrl,
      htmlBody: body.htmlBody, audienceMode, createdBy: me?.email ?? null,
    });
    await startCampaign(campaign.id);
    return NextResponse.json({ campaign: { ...campaign, status: "sending" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
