import { NextResponse } from "next/server";
import { getChannel, saveGoogleReviewsChannel } from "@/lib/channels";
import { listAccounts, listLocations, googleReviewsConfigured, type GrLocation } from "@/lib/googlereviews";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?channelId=… — the Business Profile locations this connected Google
// login can manage, across every account it has access to (flattened — most
// businesses have one account with a handful of locations, so a single list is
// simpler than a two-step account→location drill-down).
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channelId = new URL(req.url).searchParams.get("channelId");
    if (!channelId) return NextResponse.json({ locations: [], error: "channelId required" }, { status: 400 });
    const channel = await getChannel(channelId, tid);
    if (!channel || channel.kind !== "google_reviews") return NextResponse.json({ locations: [], error: "Channel not found" }, { status: 404 });
    if (!googleReviewsConfigured()) return NextResponse.json({ locations: [], error: "Google Reviews isn't configured on this deployment yet." });

    const creds = { channelId: channel.id, refreshToken: channel.token };
    const accounts = await listAccounts(creds);
    const locations: GrLocation[] = [];
    for (const acc of accounts) locations.push(...(await listLocations(creds, acc.id)));
    return NextResponse.json({ locations, accounts });
  } catch (err) {
    return NextResponse.json({ locations: [], error: errorMessage(err) });
  }
}

// POST {channelId, accountId, locationId, locationName} — finalize the
// connection: attach the picked location to the provisional channel and
// activate it.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { channelId?: string; accountId?: string; locationId?: string; locationName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.channelId || !body.accountId || !body.locationId) return NextResponse.json({ error: "channelId, accountId and locationId are required" }, { status: 400 });
  try {
    const channel = await getChannel(body.channelId, tid);
    if (!channel || channel.kind !== "google_reviews") return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const saved = await saveGoogleReviewsChannel({
      id: channel.id, tenantId: tid,
      name: body.locationName?.trim() || "Google Business Profile",
      googleAccountId: body.accountId, googleLocationId: body.locationId, active: true,
    });
    return NextResponse.json({ channel: saved });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
