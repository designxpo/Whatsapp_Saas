import { NextResponse } from "next/server";
import { currentUser, currentTenantId, requireRoleAdmin, noSession } from "@/lib/auth";
import { editCommentReply, deleteCommentReply } from "@/lib/comment-replies";
import { guardAccount } from "@/lib/feature-guard";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// PATCH { text } — correct a public reply on the platform (admins; a send, so
// the workspace must be in good standing). DELETE — take it down.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  const blocked = await guardAccount(tid);
  if (blocked) return blocked;
  const body = await req.json().catch(() => ({})) as { text?: unknown };
  if (typeof body.text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
  try {
    const user = await currentUser();
    const r = await editCommentReply(tid, (await params).id, body.text, user?.email ?? "admin");
    if (r.error) return NextResponse.json({ error: r.error, warning: r.warning }, { status: 400 });
    logActivity(user, "comment.reply_edited", `${r.reply?.platform} reply ${r.reply?.replyId}`);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  try {
    const user = await currentUser();
    const id = (await params).id;
    const r = await deleteCommentReply(tid, id, user?.email ?? "admin");
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    logActivity(user, "comment.reply_deleted", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
