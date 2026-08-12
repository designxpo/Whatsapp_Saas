import { NextResponse } from "next/server";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { escalationSweepStatus, setEscalationSweep, sweepTenantEscalations } from "@/lib/escalations";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Every read and write is scoped to the CALLER's tenant — the sweep changes
// conversation status in bulk, so it must never be configurable or triggerable
// across tenants.

// GET — this tenant's config + last run + how many of its chats would be reset now.
export async function GET() {
  try {
    const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json(await escalationSweepStatus(tenantId));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { enabled?, staleAfterDays?, everyDays? }  → save config
// POST { runNow: true }                            → sweep this tenant now
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { enabled?: boolean; staleAfterDays?: number; everyDays?: number; runNow?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    if (body.runNow) {
      // Deliberate human action, so it ignores both the interval and the enabled
      // flag — useful for clearing a backlog once before turning the schedule on.
      const r = await sweepTenantEscalations(tenantId, { force: true });
      logActivity(await currentUser(), "inbox.escalation_sweep.manual", `reset ${r.reset} chat(s)`);
      return NextResponse.json({ ...r, status: await escalationSweepStatus(tenantId) });
    }
    await setEscalationSweep(tenantId, body);
    const status = await escalationSweepStatus(tenantId);
    logActivity(await currentUser(), "settings.escalation_sweep",
      `${status.enabled ? "on" : "off"} · reset after ${status.staleAfterDays}d · every ${status.everyDays}d`);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
