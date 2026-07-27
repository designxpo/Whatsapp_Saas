import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listAdChats, saveAdChat } from "@/lib/adchats";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's saved AI-builder chat sessions (newest first), for the
// history sidebar. Metadata only (id, title, updatedAt) — load one via [id].
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ sessions: await listAdChats(tid) });
  } catch (err) {
    return NextResponse.json({ sessions: [], error: errorMessage(err) });
  }
}

// POST — save/upsert a chat session. Body: { id?, messages, plan? }. Returns the
// session id (new when none was passed) so the client keeps saving to the same row.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let b: { id?: string | null; messages?: unknown; plan?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(b.messages)) return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const { id } = await saveAdChat({ id: b.id ?? null, messages: b.messages, plan: b.plan ?? null }, tid);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
