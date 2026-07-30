import { NextResponse } from "next/server";
import { getChannel, saveYoutubeChannel } from "@/lib/channels";
import { listMyChannelOptions, youtubeConfigured } from "@/lib/youtube";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?channelId=… — the YouTube channels a just-connected (but not yet
// resolved) Google login can manage. Only reachable for a provisional
// (inactive, no ytChannelId yet) channel row the OAuth callback created when
// it found more than one candidate channel.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channelId = new URL(req.url).searchParams.get("channelId");
    if (!channelId) return NextResponse.json({ channels: [], error: "channelId required" }, { status: 400 });
    const channel = await getChannel(channelId, tid);
    if (!channel || channel.kind !== "youtube") return NextResponse.json({ channels: [], error: "Channel not found" }, { status: 404 });
    if (!youtubeConfigured()) return NextResponse.json({ channels: [], error: "YouTube isn't configured on this deployment yet." });

    const channels = await listMyChannelOptions({ channelId: channel.id, refreshToken: channel.token });
    return NextResponse.json({ channels });
  } catch (err) {
    return NextResponse.json({ channels: [], error: errorMessage(err) });
  }
}

// POST {channelId, ytChannelId, name} — finalize: attach the picked channel to
// the provisional row and activate it.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { channelId?: string; ytChannelId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.channelId || !body.ytChannelId) return NextResponse.json({ error: "channelId and ytChannelId are required" }, { status: 400 });
  try {
    const channel = await getChannel(body.channelId, tid);
    if (!channel || channel.kind !== "youtube") return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const saved = await saveYoutubeChannel({
      id: channel.id, tenantId: tid,
      name: body.name?.trim() || "YouTube channel",
      ytChannelId: body.ytChannelId, active: true,
    });
    return NextResponse.json({ channel: saved });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
