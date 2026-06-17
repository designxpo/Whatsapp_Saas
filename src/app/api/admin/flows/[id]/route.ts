import { NextResponse } from "next/server";
import { getFlow, updateFlow, deleteFlow, type FlowGraph } from "@/lib/flowengine";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const flow = await getFlow(id, tid);
    if (!flow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ flow });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PUT — save builder state. Body: { name?, active?, triggerKeywords?, channelId?, graph? }
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { name?: string; active?: boolean; triggerKeywords?: string[]; platform?: "whatsapp" | "instagram" | "both"; channelId?: string | null; graph?: FlowGraph };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await updateFlow(id, body, tid);
    logActivity(await currentUser(), "flow.save", `${body.name ?? id}${body.active !== undefined ? ` (${body.active ? "active" : "inactive"})` : ""}`);
    return NextResponse.json({ flow: await getFlow(id, tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await deleteFlow(id, tid);
    logActivity(await currentUser(), "flow.delete", id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
