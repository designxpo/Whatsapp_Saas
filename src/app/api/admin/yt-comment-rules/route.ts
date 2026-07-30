import { NextResponse } from "next/server";
import { listYtCommentRules, saveYtCommentRule, deleteYtCommentRule, YT_MODERATE_VALUES, type YtModerate } from "@/lib/ytcomments";
import { listChannels } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's YouTube comment-reply rules.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ rules: await listYtCommentRules(tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — create or update a rule for this tenant.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const rawReplies = Array.isArray(body.publicReplies) ? (body.publicReplies as unknown[]) : (body.publicReply ? [body.publicReply] : []);
  const publicReplies = rawReplies.map(v => String(v ?? "").trim().slice(0, 9000)).filter(Boolean);
  const moderate = (YT_MODERATE_VALUES as string[]).includes(String(body.moderate)) ? (body.moderate as YtModerate) : "off";
  // A rule must do something: post a reply, and/or moderate.
  if (!publicReplies.length && moderate === "off") {
    return NextResponse.json({ error: "Add at least one public reply, or choose a moderation action" }, { status: 400 });
  }
  try {
    const channels = await listChannels(tid);
    const ytChannel = channels.find(c => c.kind === "youtube");
    const reqChannelId = (body.channelId as string | null) || null;
    if (reqChannelId && !channels.some(c => c.id === reqChannelId)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const rule = await saveYtCommentRule({
      id: typeof body.id === "string" ? body.id : undefined,
      channelId: reqChannelId ?? ytChannel?.id ?? null,
      name: String(body.name ?? "").slice(0, 80),
      enabled: body.enabled === undefined ? true : !!body.enabled,
      videoId: (body.videoId as string | null) || null,
      videoTitle: (body.videoTitle as string | null) ?? null,
      videoThumbnail: (body.videoThumbnail as string | null) ?? null,
      keyword: String(body.keyword ?? "").slice(0, 200),
      publicReplies: publicReplies.slice(0, 5),
      moderate,
    }, tid);
    logActivity(await currentUser(), "settings.save", `youtube comment rule "${rule.name || rule.id}"`);
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove a rule by id (scoped to this tenant).
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteYtCommentRule(body.id, tid);
    logActivity(await currentUser(), "settings.delete", `youtube comment rule ${body.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
