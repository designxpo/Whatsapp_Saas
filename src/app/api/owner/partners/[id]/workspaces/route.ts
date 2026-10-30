import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { assignWorkspace, removeWorkspace, isPartnerSchemaMissing, PARTNER_SCHEMA_HINT } from "@/lib/partners";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

async function act(req: Request, params: Promise<{ id: string }>, fn: typeof assignWorkspace) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  let body: { tenantId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  try {
    const r = await fn(id, body.tenantId, (await currentUser())?.email ?? "owner");
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: PARTNER_SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { tenantId } — add a workspace to this partner. Owner only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return act(req, params, assignWorkspace);
}

// DELETE { tenantId } — take a workspace back from this partner; it becomes a direct Talko workspace.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return act(req, params, removeWorkspace);
}
