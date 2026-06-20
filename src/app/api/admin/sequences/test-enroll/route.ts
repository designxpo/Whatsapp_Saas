import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getSequence, getSequenceSteps, enroll, drainSequences } from "@/lib/sequences";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// POST { sequenceId, phone } — enroll one number into a sequence right now, then
// process this tenant's due steps so a 0-minute first step fires on the spot.
// The enrollment (and any send error) shows up in the monitor. Admin only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { sequenceId?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const sequenceId = (body.sequenceId || "").trim();
  if (!sequenceId) return NextResponse.json({ error: "Pick a sequence" }, { status: 400 });
  const rawPhone = (body.phone || "").trim();
  if (!rawPhone) return NextResponse.json({ error: "Enter a phone number / IG id to test with" }, { status: 400 });

  try {
    const seq = await getSequence(sequenceId, tid);
    if (!seq) return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
    if (!seq.active) return NextResponse.json({ error: "This sequence is OFF — turn it on first" }, { status: 400 });
    const steps = await getSequenceSteps(sequenceId);
    if (!steps.length) return NextResponse.json({ error: "Add at least one step before testing" }, { status: 400 });

    const phone = seq.platform === "instagram" ? rawPhone : rawPhone.replace(/\D/g, "");
    await enroll(sequenceId, { phone, platform: seq.platform }, tid);
    const processed = await drainSequences(50, tid);

    logActivity(await currentUser(), "sequence.test", `${seq.name} → ${phone}`);
    return NextResponse.json({
      success: true, processed,
      firstStepDelay: steps[0].delayMinutes,
      note: steps[0].delayMinutes > 0
        ? `Enrolled. First step sends in ${steps[0].delayMinutes} min (the cron will deliver it).`
        : "Enrolled and the first step was sent now. Check the contact + the monitor below.",
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
