import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { ensureSeeded, saveStage, deleteStage, reorderStages } from "@/lib/pipeline";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's stages (seeds a default pipeline on first use).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    return NextResponse.json({ stages: await ensureSeeded(tid) });
  } catch (err) {
    return NextResponse.json({ stages: [], error: errorMessage(err) });
  }
}

// POST — reorder ({ order: [ids] }) OR create/update a single stage.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (Array.isArray(body.order)) {
    try { await reorderStages(body.order as string[], tid); return NextResponse.json({ success: true }); }
    catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Stage name is required" }, { status: 400 });
  try {
    const stage = await saveStage({
      id: typeof body.id === "string" ? body.id : undefined,
      name: name.slice(0, 40),
      color: String(body.color ?? "").slice(0, 9) || null,
      lsqStage: String(body.lsqStage ?? "").slice(0, 80) || null,
      onEnterTag: String(body.onEnterTag ?? "").slice(0, 40) || null,
      onEnterSequenceId: (body.onEnterSequenceId as string | null) || null,
      isWon: !!body.isWon,
      isLost: !!body.isLost,
    }, tid);
    logActivity(await currentUser(), "settings.save", `pipeline stage "${stage.name}"`);
    return NextResponse.json({ stage });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0058 is applied` }, { status: 500 });
  }
}

// DELETE — remove a stage (its cards fall off the board; contacts are kept).
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteStage(body.id, tid);
    logActivity(await currentUser(), "settings.delete", `pipeline stage ${body.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
