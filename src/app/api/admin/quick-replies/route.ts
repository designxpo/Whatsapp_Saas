import { NextResponse } from "next/server";
import { listQuickReplies, createQuickReply, deleteQuickReply } from "@/lib/store";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — all canned responses (used by admin ThreadPanel + CRM chat panel).
export async function GET() {
  try {
    return NextResponse.json({ quickReplies: await listQuickReplies() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — create/update by shortcut. Body: { shortcut, body }
export async function POST(req: Request) {
  let body: { shortcut?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.shortcut?.trim() || !body.body?.trim()) return NextResponse.json({ error: "shortcut and body required" }, { status: 400 });
  try {
    await createQuickReply(body.shortcut, body.body);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — body: { id }
export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteQuickReply(body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
