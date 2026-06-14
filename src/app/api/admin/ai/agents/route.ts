import { NextResponse } from "next/server";
import { listAgents, saveAgent, deleteAgent } from "@/lib/aihub";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json({ agents: await listAgents() }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — create/update an agent (id present → update). Setting active=true
// deactivates all others (one speaking persona at a time).
export async function POST(req: Request) {
  let body: { id?: string; name?: string; description?: string; persona?: string; constraintsText?: string; productInfo?: string; model?: string; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const agent = await saveAgent({ ...body, name: body.name.trim() });
    return NextResponse.json({ agent });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { await deleteAgent(body.id); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
