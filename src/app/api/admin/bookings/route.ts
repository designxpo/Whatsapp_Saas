import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { createBooking, listBookings } from "@/lib/bookings";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?from=ISO&to=ISO — bookings starting in the range (max 62 days).
// Admins and leads see everyone's; a member sees the staff linked to them.
export async function GET(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const from = Date.parse(q.get("from") ?? ""), to = Date.parse(q.get("to") ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * 86_400_000) return NextResponse.json({ error: "Give a from/to range of up to 62 days." }, { status: 400 });
  try { return NextResponse.json(await listBookings(ctx.v, ctx.myId, new Date(from).toISOString(), new Date(to).toISOString()), { headers: { "Cache-Control": "no-store" } }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { phone, name?, serviceId?, staffId?, startsAt, durationMinutes?, notes? }
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = await createBooking(ctx.v, b);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  logActivity({ email: ctx.v.user.email, name: ctx.v.user.name, tenantId: ctx.v.tenantId }, "booking.create", `${r.booking!.title} for ${r.booking!.phone} at ${r.booking!.startsAt}`);
  return NextResponse.json({ booking: r.booking });
}
