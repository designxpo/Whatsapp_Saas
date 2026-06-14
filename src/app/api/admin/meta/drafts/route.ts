import { NextResponse } from "next/server";
import { requireRoleAdmin } from "@/lib/auth";
import { listAdDrafts, getAdDraft, saveAdDraft, deleteAdDraft } from "@/lib/adsmeta";

export const dynamic = "force-dynamic";

// GET            → list drafts (id, name, updatedAt)
// GET ?id=       → one draft with its full builder snapshot
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const draft = await getAdDraft(id);
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ draft });
  }
  return NextResponse.json({ drafts: await listAdDrafts() });
}

// POST { id?, name, data } — auto-save / save a draft. Returns its id.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string | null; name?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = await saveAdDraft({ id: body.id ?? null, name: body.name ?? "Untitled ad", data: body.data ?? {} });
  return NextResponse.json({ id });
}

// DELETE ?id= — discard a draft.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteAdDraft(id);
  return NextResponse.json({ success: true });
}
