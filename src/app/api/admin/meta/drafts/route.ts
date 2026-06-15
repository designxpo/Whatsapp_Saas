import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listAdDrafts, getAdDraft, saveAdDraft, deleteAdDraft } from "@/lib/adsmeta";

export const dynamic = "force-dynamic";

// GET            → list drafts (id, name, updatedAt)
// GET ?id=       → one draft with its full builder snapshot
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const draft = await getAdDraft(id, tid);
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ draft });
  }
  return NextResponse.json({ drafts: await listAdDrafts(tid) });
}

// POST { id?, name, data } — auto-save / save a draft. Returns its id.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string | null; name?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const id = await saveAdDraft({ id: body.id ?? null, name: body.name ?? "Untitled ad", data: body.data ?? {} }, tid);
  return NextResponse.json({ id });
}

// DELETE ?id= — discard a draft.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  await deleteAdDraft(id, tid);
  return NextResponse.json({ success: true });
}
