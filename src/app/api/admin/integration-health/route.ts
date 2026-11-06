import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { healthReport, retryDeadDeliveries, resolveUnmatchedPayment } from "@/lib/integration-health";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Admins only: connection problems name accounts and payments.
async function admin() {
  const ctx = await workContext();
  if (!ctx) return { res: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  if (ctx.v.user.role !== "admin") return { res: NextResponse.json({ error: "Only an admin can see connection health." }, { status: 403 }) };
  return { ctx };
}

// GET — which connections are working, what's broken and how to fix it.
export async function GET() {
  const a = await admin(); if (!a.ctx) return a.res;
  try { return NextResponse.json(await healthReport(a.ctx.v.tenantId), { headers: { "Cache-Control": "no-store" } }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { action: "retry_deliveries" } | { action: "resolve_payment", id, orderId? , dismiss? }
export async function POST(req: Request) {
  const a = await admin(); if (!a.ctx) return a.res;
  const { v } = a.ctx;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const actor = { email: v.user.email, name: v.user.name, tenantId: v.tenantId };
  if (b.action === "retry_deliveries") {
    const n = await retryDeadDeliveries(v.tenantId);
    logActivity(actor, "integrations.retry", `${n} failed deliveries`);
    return NextResponse.json({ ok: true, retried: n });
  }
  if (b.action === "resolve_payment" && typeof b.id === "string") {
    const action = b.dismiss === true ? { dismiss: true as const } : typeof b.orderId === "string" ? { orderId: b.orderId } : null;
    if (!action) return NextResponse.json({ error: "Choose an order, or dismiss it." }, { status: 400 });
    const r = await resolveUnmatchedPayment(v.tenantId, b.id, action, v.user.email.toLowerCase());
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    logActivity(actor, "payments.reconcile", "dismiss" in action ? `dismissed ${b.id}` : `matched ${b.id} to order ${action.orderId}`);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
