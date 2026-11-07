import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getPlan } from "@/lib/plans";
import { getTenant, ownerAudit } from "@/lib/tenants";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Platform-owner only. Grants (or revokes) a tenant's right to buy one
// invite-only plan. See src/lib/plan-eligibility.ts for how grants are used.

async function parse(req: Request): Promise<{ tenantId: string; planKey: string; note: string } | NextResponse> {
  let body: { tenantId?: unknown; planKey?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const planKey = typeof body.planKey === "string" ? body.planKey.trim() : "";
  if (!tenantId || !planKey) return NextResponse.json({ error: "tenantId and planKey required" }, { status: 400 });
  return { tenantId, planKey, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : "" };
}

async function validate(tenantId: string, planKey: string): Promise<NextResponse | null> {
  const plan = await getPlan(planKey);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (!plan.inviteOnly) return NextResponse.json({ error: "Only invite-only plans can be granted" }, { status: 400 });
  if (!(await getTenant(tenantId))) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  return null;
}

export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const p = await parse(req);
  if (p instanceof NextResponse) return p;
  try {
    const bad = await validate(p.tenantId, p.planKey);
    if (bad) return bad;
    const actor = (await currentUser())?.email ?? "owner";
    const { error } = await db().from("wa_plan_grants").upsert(
      { tenant_id: p.tenantId, plan_key: p.planKey, granted_by: actor, note: p.note || null },
      { onConflict: "tenant_id,plan_key" });
    if (error) throw error;
    await ownerAudit(actor, "plan.grant", p.tenantId, `${p.planKey}${p.note ? ` — ${p.note}` : ""}`);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const p = await parse(req);
  if (p instanceof NextResponse) return p;
  try {
    const bad = await validate(p.tenantId, p.planKey);
    if (bad) return bad;
    const { error } = await db().from("wa_plan_grants").delete().eq("tenant_id", p.tenantId).eq("plan_key", p.planKey);
    if (error) throw error;
    await ownerAudit((await currentUser())?.email ?? "owner", "plan.grant_revoke", p.tenantId, p.planKey);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
