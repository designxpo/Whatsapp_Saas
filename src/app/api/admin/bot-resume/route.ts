import { NextResponse } from "next/server";
import { currentUser, currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { botResumeStatus, setBotResume, resumeTenantBots } from "@/lib/botresume";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Turning a chat's bot back on after the team goes quiet (lib/botresume.ts).
// Always the caller's own workspace; with none, nothing (fails closed).

export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await botResumeStatus(tenantId)); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { enabled?, afterHours? } saves; POST { runNow: true } runs this workspace now.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { enabled?: boolean; afterHours?: number; runNow?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const me = await currentUser();
  const actor = me ? { email: me.email, name: me.name, tenantId } : null;
  try {
    if (body.runNow) {
      const r = await resumeTenantBots(tenantId);
      logActivity(actor, "inbox.bot_auto_resume.manual", `bot back on in ${r.resumed} chat(s)`);
      return NextResponse.json({ ...r, status: await botResumeStatus(tenantId) });
    }
    const saved = await setBotResume(tenantId, body);
    logActivity(actor, "settings.bot_auto_resume", `${saved.enabled ? "on" : "off"} · after ${saved.afterHours}h`);
    return NextResponse.json(await botResumeStatus(tenantId));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
