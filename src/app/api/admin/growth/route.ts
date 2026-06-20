import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listGrowthTools, saveGrowthTool, deleteGrowthTool, type GrowthTool, type GrowthKind } from "@/lib/growth";
import { logActivity } from "@/lib/team";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; return NextResponse.json({ tools: await listGrowthTools(tid) }); }
  catch (err) { return NextResponse.json({ tools: [], error: errorMessage(err) }); }
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: Partial<GrowthTool> & { name?: string; kind?: GrowthKind; slug?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.kind || !body.slug?.trim()) return NextResponse.json({ error: "name, kind and slug are required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const gate = await guardFeature(tid, "growth"); if (gate) return gate;
    const t = await saveGrowthTool({ ...body, name: body.name!, kind: body.kind!, slug: body.slug! }, tid);
    logActivity(await currentUser(), "growth.save", t.name);
    return NextResponse.json({ success: true, tool: t });
  } catch (err) { return NextResponse.json({ error: `${errorMessage(err)} — slug may be taken, or migration 0020 not applied` }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; await deleteGrowthTool(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
