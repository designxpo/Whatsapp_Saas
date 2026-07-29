import { NextResponse } from "next/server";
import { listCommentRules, saveCommentRule, deleteCommentRule } from "@/lib/igcomments";
import { listChannels } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's comment-to-DM rules.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ rules: await listCommentRules(tid) });
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

  const replyOnly = !!body.replyOnly;
  const dmMessage = String(body.dmMessage ?? "").trim();
  if (!replyOnly && !dmMessage) return NextResponse.json({ error: "DM message is required" }, { status: 400 });
  // Buttons: accept the new array, or the legacy single button as a fallback.
  const rawButtons = Array.isArray(body.buttons)
    ? (body.buttons as unknown[])
    : (body.buttonUrl ? [{ label: body.buttonLabel, url: body.buttonUrl }] : []);
  const buttons = rawButtons
    .map(b => { const o = (b ?? {}) as Record<string, unknown>; return { label: String(o.label ?? "").trim().slice(0, 20), url: String(o.url ?? "").trim() }; })
    .filter(b => b.url);
  if (buttons.some(b => !/^https?:\/\//i.test(b.url))) {
    return NextResponse.json({ error: "Every button link must start with http(s)://" }, { status: 400 });
  }
  // Public replies: accept the new array, or the legacy single reply as a fallback.
  const rawReplies = Array.isArray(body.publicReplies)
    ? (body.publicReplies as unknown[])
    : (body.publicReply ? [body.publicReply] : []);
  const publicReplies = rawReplies.map(v => String(v ?? "").trim().slice(0, 280)).filter(Boolean);
  if (replyOnly && !publicReplies.length) return NextResponse.json({ error: "Add at least one public reply for a reply-only rule" }, { status: 400 });
  try {
    const channels = await listChannels(tid);
    const igChannel = channels.find(c => c.kind === "instagram");
    // A client-supplied channelId must be one of this tenant's channels.
    const reqChannelId = (body.channelId as string | null) || null;
    if (reqChannelId && !channels.some(c => c.id === reqChannelId)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const rule = await saveCommentRule({
      id: typeof body.id === "string" ? body.id : undefined,
      channelId: reqChannelId ?? igChannel?.id ?? null,
      name: String(body.name ?? "").slice(0, 80),
      enabled: body.enabled === undefined ? true : !!body.enabled,
      postId: (body.postId as string | null) || null,
      postCaption: (body.postCaption as string | null) ?? null,
      postPermalink: (body.postPermalink as string | null) ?? null,
      postThumbnail: (body.postThumbnail as string | null) ?? null,
      keyword: String(body.keyword ?? "").slice(0, 200),   // comma-separated list of trigger words
      dmMessage: dmMessage.slice(0, 900),
      buttons: buttons.slice(0, 3),
      publicReplies: publicReplies.slice(0, 5),
      replyOnly,
      requireFollow: !!body.requireFollow,
      followPrompt: String(body.followPrompt ?? "").slice(0, 640),
    }, tid);
    logActivity(await currentUser(), "settings.save", `ig comment rule "${rule.name || rule.id}"`);
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
    await deleteCommentRule(body.id, tid);
    logActivity(await currentUser(), "settings.delete", `ig comment rule ${body.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
