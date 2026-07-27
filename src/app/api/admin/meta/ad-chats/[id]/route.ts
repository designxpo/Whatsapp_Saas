import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdChat, deleteAdChat } from "@/lib/adchats";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — reopen one saved chat session (messages + last drafted plan).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const { id } = await params;
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const session = await getAdChat(id, tid);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove a saved chat session.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const { id } = await params;
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await deleteAdChat(id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
