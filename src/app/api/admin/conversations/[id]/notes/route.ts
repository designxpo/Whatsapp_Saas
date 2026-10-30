import { NextResponse } from "next/server";
import { getConversation, listConversationNotes, addConversationNote, deleteConversationNote, NOTE_MAX } from "@/lib/store";
import { currentUser, currentTenantId } from "@/lib/auth";
import { visibleChannelIds, canSeeConversation } from "@/lib/teams";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Private team notes on one conversation (store.ts, migration 20261030120000).
//   GET               the notes, oldest first
//   POST { body }     add one, as the signed-in person
//   DELETE ?noteId=   remove one — its author's own, or any for an admin
//
// The signed-in business only, and the same team scope as the chat itself: a
// note on a chat you cannot open is a note you cannot read or write. The
// activity log records that a note was added or removed, never what it said.

type Ctx = { params: Promise<{ id: string }> };
type Access =
  | { ok: false; res: NextResponse }
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof currentUser>>>; tid: string; id: string };

async function access(ctx: Ctx): Promise<Access> {
  const [user, tid] = await Promise.all([currentUser(), currentTenantId()]);
  if (!user || !tid) return { ok: false, res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { id } = await ctx.params;
  const conv = await getConversation(id, tid);
  if (!conv || !canSeeConversation(await visibleChannelIds(user), conv.channelId ?? null)) {
    return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true, user, tid, id };
}

export async function GET(_req: Request, ctx: Ctx) {
  const a = await access(ctx);
  if (!a.ok) return a.res;
  // `viewer` lets the panel offer Delete only where it would succeed.
  return NextResponse.json({ notes: await listConversationNotes(a.tid, a.id), viewer: { email: a.user.email, isAdmin: a.user.role === "admin" } });
}

export async function POST(req: Request, ctx: Ctx) {
  const a = await access(ctx);
  if (!a.ok) return a.res;
  let body: { body?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "A note needs some text." }, { status: 400 });
  if (text.length > NOTE_MAX) return NextResponse.json({ error: `Keep a note under ${NOTE_MAX} characters.` }, { status: 400 });
  try {
    const note = await addConversationNote(a.tid, a.id, { email: a.user.email, name: a.user.name }, text);
    logActivity(a.user, "note.add", `conversation ${a.id}`);
    return NextResponse.json({ note });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await access(ctx);
  if (!a.ok) return a.res;
  const noteId = new URL(req.url).searchParams.get("noteId") ?? "";
  if (!noteId) return NextResponse.json({ error: "noteId is required" }, { status: 400 });
  try {
    const removed = await deleteConversationNote(a.tid, a.id, noteId, { email: a.user.email, isAdmin: a.user.role === "admin" });
    if (!removed) return NextResponse.json({ error: "Only the person who wrote a note, or an admin, can delete it." }, { status: 403 });
    logActivity(a.user, "note.delete", `conversation ${a.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
