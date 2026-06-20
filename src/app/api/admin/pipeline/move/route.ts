import { NextResponse, after } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { moveContact, applyStageEffects } from "@/lib/pipeline";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { contactId, stageId } — move a card (tenant-scoped). The stage update is
// synchronous; on-enter automation + LeadSquared sync run after the response.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { contactId?: string; stageId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.contactId) return NextResponse.json({ error: "contactId required" }, { status: 400 });
  try {
    const stageId = body.stageId || null;
    await moveContact(body.contactId, stageId, tid);
    if (stageId) after(() => applyStageEffects(body.contactId!, stageId, tid));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
