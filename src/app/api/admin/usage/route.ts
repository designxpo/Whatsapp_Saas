import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getTenantUsage, getPlanLimits } from "@/lib/usage";
import { getTenant } from "@/lib/tenants";
import { getYtDailyReplyCap, ytActionsUsedToday, hasYoutubeChannel } from "@/lib/ytcomments";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the current tenant's usage vs plan limits (drives the usage card). Also
// reports today's YouTube AI-reply usage against the plan's daily cap (a distinct
// DAILY meter, separate from the monthly limits), so the card can nudge an upgrade
// as the tenant approaches it.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [usage, limits, tenant, ytLimit, ytUsed, ytChannel] = await Promise.all([
      getTenantUsage(user.tenantId), getPlanLimits(user.tenantId), getTenant(user.tenantId),
      getYtDailyReplyCap(user.tenantId), ytActionsUsedToday(user.tenantId), hasYoutubeChannel(user.tenantId),
    ]);
    return NextResponse.json({
      usage, limits, plan: tenant?.plan ?? "trial", status: tenant?.status ?? "active", trialEndsAt: tenant?.trialEndsAt ?? null,
      yt: { used: ytUsed, limit: ytLimit, hasChannel: ytChannel },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
