import { NextResponse } from "next/server";
import { getChannel, saveGoogleReviewsChannel, listChannels, deleteChannel } from "@/lib/channels";
import { listAccounts, listLocations, googleReviewsConfigured, type GrLocation } from "@/lib/googlereviews";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// GET ?channelId=… — the Business Profile locations this connected Google
// login can manage, across every account it has access to (flattened — most
// businesses have one account with a handful of locations, so a single list is
// simpler than a two-step account→location drill-down).
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const gate = await guardFeature(tid, "reviews");
    if (gate) return gate;
    const channelId = new URL(req.url).searchParams.get("channelId");
    if (!channelId) return NextResponse.json({ locations: [], error: "channelId required" }, { status: 400 });
    const channel = await getChannel(channelId, tid);
    if (!channel || channel.kind !== "google_reviews") return NextResponse.json({ locations: [], error: "Channel not found" }, { status: 404 });
    if (!googleReviewsConfigured()) return NextResponse.json({ locations: [], error: "Google Reviews isn't configured on this deployment yet." });

    const creds = { channelId: channel.id, refreshToken: channel.token };
    const acc = await listAccounts(creds);
    if (acc.error) return NextResponse.json({ locations: [], accounts: [], error: acc.error });
    const locations: GrLocation[] = [];
    let locError: string | undefined;
    for (const a of acc.accounts) {
      const res = await listLocations(creds, a.id);
      if (res.error) { locError = res.error; continue; }   // one bad account shouldn't hide the others
      locations.push(...res.locations);
    }
    // Only surface a location error when nothing at all came back, so a partial
    // success still lets the admin pick a location.
    if (!locations.length && locError) return NextResponse.json({ locations: [], accounts: acc.accounts, error: locError });
    if (!locations.length) return NextResponse.json({ locations: [], accounts: acc.accounts, error: "That Google account has a Business Profile but no locations we can manage yet." });
    return NextResponse.json({ locations, accounts: acc.accounts });
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
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
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
    // Reconnecting the same location (the fix for revoked access) creates a new
    // row. Remove the old one, as Disconnect would, so the poller and replies
    // can't keep using the dead login. Imported reviews aren't tied to a row.
    const superseded = (await listChannels(tid)).filter(c => c.kind === "google_reviews" && c.id !== saved.id && c.googleLocationId === body.locationId);
    for (const old of superseded) await deleteChannel(old.id, tid);

    // Never send the stored Google refresh token to the browser.
    const { token: _token, ...safe } = saved;
    return NextResponse.json({ channel: safe });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
