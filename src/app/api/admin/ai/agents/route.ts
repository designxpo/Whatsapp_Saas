import { NextResponse } from "next/server";
import { listAgents, saveAgent, deleteAgent } from "@/lib/aihub";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; return NextResponse.json({ agents: await listAgents(tid) }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — create/update an agent (id present → update). Setting active=true
// deactivates all others (one speaking persona at a time).
export async function POST(req: Request) {
  let body: { id?: string; name?: string; description?: string; persona?: string; constraintsText?: string; productInfo?: string; model?: string; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const agent = await saveAgent({ ...body, name: body.name.trim() }, tid);
    return NextResponse.json({ agent });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; await deleteAgent(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
