import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { drainYtComments } from "@/lib/ytpoller";
import { currentTenantId, requireAdmin, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;   // a poll can involve several Google round-trips + an AI call

// GET — what the last YouTube poll actually did, per connected channel. Exists
// so "the reply didn't appear" is diagnosable from the portal instead of
// requiring cron logs: it reports whether the poller ran at all, how many
// comments it saw, how many replies it posted, and the id of the last reply
// (which can be looked up on YouTube to prove it was accepted).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Sign in required" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const { data, error } = await db().from("wa_yt_poll_cursor").select("*").eq("tenant_id", tid);
    // Pre-0097 DB (or table absent) → no status rather than a hard failure.
    if (error) return NextResponse.json({ status: [] });
    const status = (data ?? []).map(r => {
      const d = r as Record<string, unknown>;
      return {
        channelId: d.channel_id as string,
        lastCheckedAt: (d.last_checked_at as string | null) ?? (d.last_polled_at as string | null) ?? null,
        commentsSeen: (d.comments_seen as number | null) ?? null,
        repliesPosted: (d.replies_posted as number | null) ?? null,
        lastReplyId: (d.last_reply_id as string | null) ?? null,
        lastReplyAt: (d.last_reply_at as string | null) ?? null,
        lastError: (d.last_error as string | null) ?? null,
      };
    });
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ status: [], error: errorMessage(err) });
  }
}

// POST — "Check now": run the poll for THIS tenant immediately instead of
// waiting for the next 5-minute cron tick. Same code path as the cron, so it
// respects the dedupe log and rate caps; it can't double-reply.
export async function POST() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    const acted = await drainYtComments(tid);
    return NextResponse.json({ acted });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
