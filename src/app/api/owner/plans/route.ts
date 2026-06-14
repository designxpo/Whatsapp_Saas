import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listPlans, savePlan, deletePlan, type Plan } from "@/lib/plans";
import { ownerAudit } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ plans: await listPlans() }); }
  catch (err) { return NextResponse.json({ plans: [], error: errorMessage(err) }); }
}

export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Partial<Plan> & { key?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.key?.trim() || !body.name?.trim()) return NextResponse.json({ error: "key and name are required" }, { status: 400 });
  try {
    const plan = await savePlan({ ...body, key: body.key!, name: body.name! });
    await ownerAudit((await currentUser())?.email ?? "owner", "plan.save", null, plan.key);
    return NextResponse.json({ success: true, plan });
  } catch (err) { return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0025 is applied` }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { await deletePlan(body.id); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
