import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { getIntegration, getIntegrationSecret } from "@/lib/integrations";
import { outlets } from "@/lib/mezmitra";

export const dynamic = "force-dynamic";

// GET — the linked Mezmitra restaurant's outlets, live, for picking which one the
// AI and the "Book table" step use when the guest doesn't name one.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const integration = await getIntegration(id, tid);
  if (!integration || integration.kind !== "mezmitra") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = await getIntegrationSecret(id, tid);
  if (!key) return NextResponse.json({ error: "Not linked" }, { status: 409 });
  const res = await outlets(key);
  if (!res.ok) return NextResponse.json({ error: res.message }, { status: 502 });
  return NextResponse.json({
    outlets: res.data.outlets.map(o => ({ id: o.id, name: o.name, city: o.city, bookingOn: o.online_booking.enabled })),
    defaultOutletId: (integration.config.defaultOutletId as string | null) ?? null,
  });
}
