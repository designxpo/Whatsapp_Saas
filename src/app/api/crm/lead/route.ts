import { NextResponse } from "next/server";
import { crmAuthorized } from "@/lib/crm";
import { ensureLead, getLeadIdByPhone, updateLeadStage, createLeadTask } from "@/lib/leadsquared";

export const dynamic = "force-dynamic";

const DEFAULT_STAGES = ["New", "Contacted", "Qualified", "Opportunity", "Customer", "Lost"];

// GET — the stage options for the panel's dropdown (LSQ_STAGES env, comma-sep).
export async function GET(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const env = (process.env.LSQ_STAGES ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return NextResponse.json({ stages: env.length ? env : DEFAULT_STAGES });
}

// POST { action: "ensure" | "stage" | "task", phone, ... } — push data INTO LSQ.
//   ensure: create/sync the lead         → { leadId }
//   stage:  { stage }                     → move ProspectStage
//   task:   { taskName, taskNotes?, dueDate? } → create a follow-up task
export async function POST(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { action?: string; phone?: string; name?: string; stage?: string; taskName?: string; taskNotes?: string; dueDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  if (body.action === "ensure") {
    const leadId = await ensureLead(phone, body.name, "WhatsApp");
    return leadId ? NextResponse.json({ success: true, leadId }) : NextResponse.json({ error: "Could not create the lead (LSQ off or auto-create disabled)." }, { status: 502 });
  }

  if (body.action === "stage") {
    if (!body.stage?.trim()) return NextResponse.json({ error: "stage required" }, { status: 400 });
    const leadId = await getLeadIdByPhone(phone);
    if (!leadId) return NextResponse.json({ error: "Lead not found in CRM." }, { status: 404 });
    const ok = await updateLeadStage(leadId, body.stage.trim());
    return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Stage update failed." }, { status: 502 });
  }

  if (body.action === "task") {
    if (!body.taskName?.trim()) return NextResponse.json({ error: "taskName required" }, { status: 400 });
    const leadId = await getLeadIdByPhone(phone);
    if (!leadId) return NextResponse.json({ error: "Lead not found in CRM." }, { status: 404 });
    const ok = await createLeadTask(leadId, { name: body.taskName.trim(), notes: body.taskNotes, dueDate: body.dueDate });
    return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Task create failed." }, { status: 502 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
