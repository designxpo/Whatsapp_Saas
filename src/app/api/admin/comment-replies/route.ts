import { NextResponse } from "next/server";
import { currentUser, currentTenantId, noSession } from "@/lib/auth";
import { listCommentReplies, REPLY_PLATFORMS, type ReplyPlatform } from "@/lib/comment-replies";
import { historyStatus } from "@/lib/comment-history";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?platform=youtube|instagram|facebook &days=7|30|90|365 &cursor= &channelId=
// — one page of the public comment replies posted for this workspace, newest
// first. The first page also carries the total and how the import of earlier
// replies is going.
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform") as ReplyPlatform;
  if (!REPLY_PLATFORMS.includes(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  try {
    const tid = await currentTenantId();
    if (!tid) return noSession();
    const cursor = url.searchParams.get("cursor");
    const r = await listCommentReplies(tid, { platform, channelId: url.searchParams.get("channelId"), days: Number(url.searchParams.get("days")) || null, cursor });
    const history = cursor || r.setupNeeded ? undefined : await historyStatus(tid, platform).catch(() => undefined);
    return NextResponse.json({ ...r, history });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
