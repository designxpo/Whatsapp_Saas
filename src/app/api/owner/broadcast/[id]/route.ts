import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { getCampaign, cancelCampaign } from "@/lib/ownerbroadcast";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — one campaign (progress lives on the row itself; the per-recipient
// delivery report is /api/owner/emails?campaignId=<id>, which already carries
// delivered/opened/clicked from the Resend webhook).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — stop a campaign mid-flight. Emails already sent are gone; this only
// prevents what's still queued from going out.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const stopped = await cancelCampaign(id);
    if (!stopped) return NextResponse.json({ error: "That campaign has already finished sending." }, { status: 409 });
    return NextResponse.json({ cancelled: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
