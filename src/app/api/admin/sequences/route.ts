import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { listSequences, getSequenceSteps, createSequence, updateSequence, deleteSequence, setSequenceSteps, type SequenceTriggerKind, type SequenceStepAction } from "@/lib/sequences";
import { resolveStepAudiences } from "@/lib/seqaudience";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";
import { isLane, isAidaStage } from "@/lib/lanes";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

// GET — all sequences with their steps.
export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const seqs = await listSequences(tenantId);
    const withSteps = await Promise.all(seqs.map(async s => ({ ...s, steps: await getSequenceSteps(s.id, tenantId) })));
    return NextResponse.json({ sequences: withSteps });
  } catch (err) {
    return NextResponse.json({ sequences: [], error: errorMessage(err) });
  }
}

// POST — create/update a sequence + its steps.
export async function POST(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; name?: string; platform?: "whatsapp" | "instagram"; triggerKind?: SequenceTriggerKind; triggerValue?: string | null; channelId?: string | null; active?: boolean; team?: string | null; aidaStage?: string | null; steps?: { delayMinutes: number; action: SequenceStepAction; audience?: unknown }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  // Narrowed, not cast. These arrive from a form and end up in a CHECK
  // constraint; an unrecognised value would fail the insert with a Postgres
  // error rather than "that is not a lane".
  const team = isLane(body.team) ? body.team : null;
  const aidaStage = isAidaStage(body.aidaStage) ? body.aidaStage : null;
  try {
    if (body.channelId && !await tenantChannel(body.channelId, tenantId)) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    let id = body.id;
    if (id) {
      await updateSequence(id, { name: body.name, platform: body.platform, triggerKind: body.triggerKind, triggerValue: body.triggerValue ?? null, channelId: body.channelId ?? null, active: body.active, team, aidaStage }, tenantId);
    } else {
      const seq = await createSequence({ name: body.name, platform: body.platform, triggerKind: body.triggerKind, triggerValue: body.triggerValue ?? null, channelId: body.channelId ?? null, team, aidaStage }, tenantId);
      id = seq.id;
    }
    if (Array.isArray(body.steps)) {
      // ── Never let a save silently widen a restricted step ────────────────
      //
      // setSequenceSteps deletes and re-inserts, so a step arriving without
      // an audience is a step that goes to EVERYONE from now on. A client
      // that predates 0103 — a browser tab left open across the deploy —
      // sends exactly that, and the restricted steps would quietly
      // start sending an unverified salary claim to the whole enrolment.
      //
      // `"audience" in step` tells an OMITTED key apart from an explicit
      // null, so clearing a rule on purpose still works while forgetting to
      // send one preserves what is there.
      const prior = body.id ? await getSequenceSteps(body.id, tenantId).catch(() => []) : [];
      const audiences = resolveStepAudiences(
        body.steps as unknown as Record<string, unknown>[],
        prior.map(p => p.audience),
      );
      await setSequenceSteps(id!, body.steps.map((st, i) => ({
        delayMinutes: st.delayMinutes, action: st.action, audience: audiences[i],
      })), tenantId);
    }
    logActivity(await currentUser(), "sequence.save", body.name);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0020 is applied` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { await deleteSequence(body.id, tenantId); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
