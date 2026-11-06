import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { requestDeposit, updateBooking } from "@/lib/bookings";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// PATCH { status?, startsAt?, staffId?, cancelReason? } — confirm, complete,
// mark a no-show, cancel, or move a booking.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = await updateBooking(ctx.v, ctx.myId, id, b);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  logActivity({ email: ctx.v.user.email, name: ctx.v.user.name, tenantId: ctx.v.tenantId }, "booking.update", `${id}: ${JSON.stringify(b).slice(0, 200)}`);
  return NextResponse.json({ booking: r.booking });
}

// POST { action: "deposit" } — request the deposit (an order with a pay link).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== "deposit") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const r = await requestDeposit(ctx.v, ctx.myId, id);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  logActivity({ email: ctx.v.user.email, name: ctx.v.user.name, tenantId: ctx.v.tenantId }, "booking.deposit", id);
  return NextResponse.json(r);
}
