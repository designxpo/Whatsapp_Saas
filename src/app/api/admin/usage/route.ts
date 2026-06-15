import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getTenantUsage, getPlanLimits } from "@/lib/usage";
import { getTenant } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the current tenant's usage vs plan limits (drives the usage card).
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [usage, limits, tenant] = await Promise.all([
      getTenantUsage(user.tenantId), getPlanLimits(user.tenantId), getTenant(user.tenantId),
    ]);
    return NextResponse.json({ usage, limits, plan: tenant?.plan ?? "trial", status: tenant?.status ?? "active", trialEndsAt: tenant?.trialEndsAt ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
