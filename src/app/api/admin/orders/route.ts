import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listOrders, getOrderStats, updateOrderStatus, type OrderStatus } from "@/lib/commerce";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["pending", "paid", "fulfilled", "cancelled", "refunded"];

// GET — this tenant's orders (newest first) + a status/revenue rollup.
// ?status=paid filters; ?q=98765 searches by phone.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("q") ?? undefined;
    const [orders, stats] = await Promise.all([
      listOrders(tid, { status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined, search }),
      getOrderStats(tid),
    ]);
    return NextResponse.json({ orders, stats });
  } catch (err) {
    return NextResponse.json({ orders: [], error: errorMessage(err) });
  }
}

// PATCH — move an order's status (fulfil / cancel / refund / mark paid).
export async function PATCH(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let b: { id?: string; status?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b.id || !STATUSES.includes(b.status as OrderStatus)) return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const res = await updateOrderStatus(b.id, b.status as OrderStatus, tid);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    logActivity(await currentUser(), "order.status", `${b.id.slice(0, 8)} → ${b.status}`);
    return NextResponse.json({ success: true, order: res.order });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
