import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { getBookingSettings, listServices, saveBookingSettings, saveService, saveStaff } from "@/lib/bookings";
import { listUsers } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — services, staff, reminder settings and teammates (for linking staff).
export async function GET() {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const [s, settings, users] = await Promise.all([listServices(ctx.v.tenantId), getBookingSettings(ctx.v.tenantId), listUsers(ctx.v.tenantId).catch(() => [])]);
    return NextResponse.json({ ...s, settings, canManage: ctx.v.user.role === "admin", team: users.filter(u => u.active).map(u => ({ id: u.id, name: u.name || u.email })) });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { service } | { staff } | { settings } — admins only.
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (ctx.v.user.role !== "admin") return NextResponse.json({ error: "Only an admin can change services, staff or reminders." }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = b.service ? await saveService(ctx.v.tenantId, b.service as Record<string, unknown>)
    : b.staff ? await saveStaff(ctx.v.tenantId, b.staff as Record<string, unknown>)
    : b.settings ? { ok: true as const, settings: await saveBookingSettings(ctx.v.tenantId, b.settings) }
    : { error: "Nothing to save", status: 400 };
  return "error" in r && r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json(r);
}
