import { NextResponse } from "next/server";
import { listRules, saveRule, setRuleActive, deleteRule, type ApiRule } from "@/lib/apirules";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ rules: await listRules(tid) });
  } catch (err) {
    // Migration 0012 not applied yet — let the UI render with a notice.
    return NextResponse.json({ rules: [], notice: `API rules unavailable: ${errorMessage(err)}` });
  }
}

// POST — create/update a rule, or toggle with { id, active }.
export async function POST(req: Request) {
  let body: Partial<ApiRule> & { name?: string; eventKey?: string; templateName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    if (body.id && typeof body.active === "boolean" && !body.name) {
      await setRuleActive(body.id, body.active, tid);
      logActivity(await currentUser(), "rule.toggle", `${body.id} → ${body.active ? "active" : "inactive"}`);
      return NextResponse.json({ success: true });
    }
    if (!body.name?.trim() || !body.eventKey?.trim() || !body.templateName?.trim()) {
      return NextResponse.json({ error: "name, eventKey and templateName are required" }, { status: 400 });
    }
    const rule = await saveRule(body as Parameters<typeof saveRule>[0], tid);
    logActivity(await currentUser(), "rule.save", `${rule.name} (${rule.eventKey})`);
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    await deleteRule(body.id, tid);
    logActivity(await currentUser(), "rule.delete", body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
