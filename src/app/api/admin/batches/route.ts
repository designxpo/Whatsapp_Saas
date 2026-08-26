import { NextResponse } from "next/server";
import { listBatches, createBatch, batchSize, consentStats, type BatchFilter } from "@/lib/audience";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET — every live batch with its current size, plus consent totals for the
// compliance panel. Sizes are resolved per batch (a dynamic batch's size is only
// knowable by running its filter), so this is capped to the batches a person
// actually has rather than being a hot path.
export async function GET(req: Request) {
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const batches = await listBatches(tid, includeArchived);
    const sized = await Promise.all(batches.map(async b => ({
      ...b,
      size: await batchSize(b.id, tid).catch(() => 0),
    })));
    return NextResponse.json({ batches: sized, consent: await consentStats(tid).catch(() => null) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — create a batch.
// Body: { name, description?, kind?: "static"|"dynamic", filter? }
export async function POST(req: Request) {
  let body: { name?: string; description?: string; kind?: string; filter?: BatchFilter };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const kind = body.kind === "dynamic" ? "dynamic" : "static";
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const who = await currentUser();
    const batch = await createBatch({
      name, description: body.description ?? null, kind,
      filter: body.filter ?? {}, createdBy: who?.name || who?.email || "admin", tenantId: tid,
    });
    logActivity(who, "batch.create", `${name} (${kind})`);
    return NextResponse.json({ success: true, batch });
  } catch (err) {
    // createBatch turns a name collision into a readable message — a 409 tells
    // the UI to keep the typed name rather than treating it as a server fault.
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: /already exists/i.test(msg) ? 409 : 500 });
  }
}
