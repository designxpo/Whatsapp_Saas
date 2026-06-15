import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listSequences, getSequenceSteps, createSequence, updateSequence, deleteSequence, setSequenceSteps, type SequenceTriggerKind, type SequenceStepAction } from "@/lib/sequences";
import { logActivity } from "@/lib/team";
import { getChannel } from "@/lib/channels";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — all sequences with their steps.
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const seqs = await listSequences(tid);
    const withSteps = await Promise.all(seqs.map(async s => ({ ...s, steps: await getSequenceSteps(s.id) })));
    return NextResponse.json({ sequences: withSteps });
  } catch (err) {
    return NextResponse.json({ sequences: [], error: errorMessage(err) });
  }
}

// POST — create/update a sequence + its steps.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; name?: string; platform?: "whatsapp" | "instagram"; triggerKind?: SequenceTriggerKind; triggerValue?: string | null; channelId?: string | null; active?: boolean; steps?: { delayMinutes: number; action: SequenceStepAction }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    // A client-supplied channelId must belong to this tenant — the sequence
    // cron later sends from it, so a foreign id = cross-tenant credential abuse.
    if (body.channelId && !(await getChannel(body.channelId, tid))) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    let id = body.id;
    if (id) {
      await updateSequence(id, { name: body.name, platform: body.platform, triggerKind: body.triggerKind, triggerValue: body.triggerValue ?? null, channelId: body.channelId ?? null, active: body.active }, tid);
    } else {
      const seq = await createSequence({ name: body.name, platform: body.platform, triggerKind: body.triggerKind, triggerValue: body.triggerValue ?? null, channelId: body.channelId ?? null }, tid);
      id = seq.id;
    }
    if (Array.isArray(body.steps)) await setSequenceSteps(id!, body.steps, tid);
    logActivity(await currentUser(), "sequence.save", body.name);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0020 is applied` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID; await deleteSequence(body.id, tid); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
