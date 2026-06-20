import { NextResponse } from "next/server";
import { listCommentRules, saveCommentRule, deleteCommentRule } from "@/lib/fbcomments";
import { listChannels } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's Facebook comment-to-DM rules.
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

  const dmMessage = String(body.dmMessage ?? "").trim();
  if (!dmMessage) return NextResponse.json({ error: "DM message is required" }, { status: 400 });
  const buttonUrl = String(body.buttonUrl ?? "").trim();
  if (buttonUrl && !/^https?:\/\//i.test(buttonUrl)) {
    return NextResponse.json({ error: "Button link must start with http(s)://" }, { status: 400 });
  }
  try {
    const channels = await listChannels(tid);
    const fbChannel = channels.find(c => c.kind === "messenger");
    // A client-supplied channelId must be one of this tenant's channels.
    const reqChannelId = (body.channelId as string | null) || null;
    if (reqChannelId && !channels.some(c => c.id === reqChannelId)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const rule = await saveCommentRule({
      id: typeof body.id === "string" ? body.id : undefined,
      channelId: reqChannelId ?? fbChannel?.id ?? null,
      name: String(body.name ?? "").slice(0, 80),
      enabled: body.enabled === undefined ? true : !!body.enabled,
      postId: (body.postId as string | null) || null,
      postCaption: (body.postCaption as string | null) ?? null,
      postPermalink: (body.postPermalink as string | null) ?? null,
      postThumbnail: (body.postThumbnail as string | null) ?? null,
      keyword: String(body.keyword ?? "").slice(0, 60),
      dmMessage: dmMessage.slice(0, 900),
      buttonLabel: String(body.buttonLabel ?? "").slice(0, 20),
      buttonUrl,
      publicReply: String(body.publicReply ?? "").slice(0, 280),
    }, tid);
    logActivity(await currentUser(), "settings.save", `fb comment rule "${rule.name || rule.id}"`);
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
    logActivity(await currentUser(), "settings.delete", `fb comment rule ${body.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
