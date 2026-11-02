import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { listAgents, saveAgent, deleteAgent } from "@/lib/aihub";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  try {
    // Admins see whole personas; everyone else only what a picker needs.
    const agents = await listAgents(g.tid);
    return NextResponse.json({ agents: g.admin ? agents : agents.map(a => ({ id: a.id, name: a.name, active: a.active })) });
  }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST — create/update an agent (id present → update). Setting active=true
// deactivates all others (one speaking persona at a time).
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let body: { id?: string; name?: string; description?: string; persona?: string; constraintsText?: string; productInfo?: string; model?: string; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    const tid = g.tid;
    const agent = await saveAgent({ ...body, name: body.name.trim() }, tid);
    return NextResponse.json({ agent });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = g.tid; await deleteAgent(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
