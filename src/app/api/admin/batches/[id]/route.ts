import { NextResponse } from "next/server";
import {
  getBatch, updateBatch, archiveBatch, addBatchMembers, removeBatchMembers,
  addBatchMembersFromFilter, resolveBatch, consentMissing, batchMembers, type BatchFilter,
} from "@/lib/audience";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET — one batch, its resolved recipients, and how many of them cannot receive
// a marketing template. Showing the consent shortfall next to the membership is
// the point: a batch of 500 with 300 unconsented is a 200-person audience, and
// the person choosing it should see that before sending.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const batch = await getBatch(id, tid);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    const recipients = await resolveBatch(id, tid);
    const page = await batchMembers(id, offset, limit, tid).catch(() => ({ members: [], total: 0 }));
    // Same reasoning as the broadcast preview: a consent-lookup failure must not
    // make a real batch look empty.
    const missing = await consentMissing(recipients.map(r => r.phone), tid).then(s => s.size).catch(() => null);
    return NextResponse.json({
      batch,
      size: recipients.length,
      noConsent: missing,
      marketingReach: missing === null ? null : Math.max(0, recipients.length - missing),
      members: page.members,
      memberTotal: page.total,
      offset, limit,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH — rename / re-describe / retarget (dynamic only).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { name?: string; description?: string; filter?: BatchFilter };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const batch = await getBatch(id, tid);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    // A static batch has no filter to change — accepting one silently would
    // imply a retarget that never happens.
    if (body.filter !== undefined && batch.kind !== "dynamic") {
      return NextResponse.json({ error: "Only a dynamic batch has a filter. Add members instead." }, { status: 400 });
    }
    await updateBatch(id, body, tid);
    logActivity(await currentUser(), "batch.update", batch.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: /name/i.test(msg) ? 409 : 500 });
  }
}

// POST — membership actions on a static batch, plus archive/restore.
// Body: { action: "addMembers"|"removeMembers"|"addFromFilter"|"archive"|"restore", … }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { action?: string; contactIds?: string[]; filter?: BatchFilter };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const batch = await getBatch(id, tid);
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    const who = await currentUser();
    const actor = who?.name || who?.email || "admin";

    if (body.action === "archive" || body.action === "restore") {
      await archiveBatch(id, body.action === "archive", tid);
      logActivity(who, `batch.${body.action}`, batch.name);
      return NextResponse.json({ success: true });
    }

    // Membership only exists for static batches — a dynamic batch's members come
    // from its filter, so adding to one would be a silent no-op at send time.
    if (batch.kind !== "static") {
      return NextResponse.json({ error: "This is a dynamic batch — edit its filter instead of its members." }, { status: 400 });
    }

    if (body.action === "addMembers") {
      const ids = Array.isArray(body.contactIds) ? body.contactIds : [];
      if (!ids.length) return NextResponse.json({ error: "contactIds[] required" }, { status: 400 });
      const added = await addBatchMembers(id, ids, actor, tid);
      logActivity(who, "batch.addMembers", `${added} → ${batch.name}`);
      return NextResponse.json({ success: true, added, requested: ids.length });
    }
    if (body.action === "removeMembers") {
      const ids = Array.isArray(body.contactIds) ? body.contactIds : [];
      if (!ids.length) return NextResponse.json({ error: "contactIds[] required" }, { status: 400 });
      await removeBatchMembers(id, ids, tid);
      logActivity(who, "batch.removeMembers", `${ids.length} from ${batch.name}`);
      return NextResponse.json({ success: true, removed: ids.length });
    }
    if (body.action === "addFromFilter") {
      const added = await addBatchMembersFromFilter(id, body.filter ?? {}, actor, tid);
      logActivity(who, "batch.addFromFilter", `${added} → ${batch.name}`);
      return NextResponse.json({ success: true, added });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
