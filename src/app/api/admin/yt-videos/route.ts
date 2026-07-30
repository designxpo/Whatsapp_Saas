import { NextResponse } from "next/server";
import { listChannels } from "@/lib/channels";
import { listVideos, youtubeConfigured } from "@/lib/youtube";
import { currentTenantId, requireAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's YouTube videos for the rule video-picker. ?channelId=…
// selects a specific connected channel; otherwise the first active one.
// Read-only, so any logged-in team member can browse it.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channelId = new URL(req.url).searchParams.get("channelId");
    const yts = (await listChannels(tid)).filter(c => c.kind === "youtube" && c.ytChannelId && c.token);
    const yt = (channelId && yts.find(c => c.id === channelId)) || yts.find(c => c.active) || yts[0];
    if (!yt || !yt.ytChannelId) return NextResponse.json({ videos: [], error: "Connect a YouTube channel first" });
    if (!youtubeConfigured()) return NextResponse.json({ videos: [], error: "YouTube isn't configured on this deployment yet (Google OAuth pending)." });
    const videos = await listVideos({ channelId: yt.ytChannelId, refreshToken: yt.token });
    return NextResponse.json({ videos });
  } catch (err) {
    return NextResponse.json({ videos: [], error: errorMessage(err) });
  }
}
