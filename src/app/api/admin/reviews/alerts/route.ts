import { NextResponse } from "next/server";
import { openAlerts, alertHref } from "@/lib/review-alerts";
import { currentTenantId, requireRoleAdmin, noSession } from "@/lib/auth";
import { checkFeature } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

// GET — recent review alerts that still need something, for the alert bell.
// Admins only (they are the ones who can act on a review); everyone else, and
// a plan without Google Reviews, just gets an empty list so the bell stays quiet.
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ alerts: [] });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  if (!(await checkFeature(tid, "reviews").catch(() => ({ ok: false }))).ok) return NextResponse.json({ alerts: [] });
  const alerts = await openAlerts(tid).catch(() => []);
  return NextResponse.json({ alerts: alerts.map(a => ({ ...a, href: alertHref(a) })) });
}
