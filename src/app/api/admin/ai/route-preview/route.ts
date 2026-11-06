import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { getAgentById } from "@/lib/aihub";
import { previewRoute } from "@/lib/route-preview";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { message, currentAgentId? } — which persona would answer this message,
// and why. Nothing is sent and no chat changes; it only scores the message.
export async function POST(req: Request) {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  let b: { message?: unknown; currentAgentId?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const message = typeof b.message === "string" ? b.message.trim().slice(0, 1000) : "";
  if (!message) return NextResponse.json({ error: "Type a customer message to test." }, { status: 400 });
  try {
    const current = typeof b.currentAgentId === "string" && b.currentAgentId ? await getAgentById(b.currentAgentId, g.tid) : null;
    if (typeof b.currentAgentId === "string" && b.currentAgentId && !current) return NextResponse.json({ error: "That persona isn't in this workspace." }, { status: 404 });
    return NextResponse.json(await previewRoute(g.tid, message, current ? { id: current.id, name: current.name } : null));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
