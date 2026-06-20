// Route-level feature guard. One-liner for API routes:
//   const gate = await guardFeature(tid, "flows"); if (gate) return gate;
// Returns a 402 (payment-required) response when the tenant's plan doesn't
// include the feature, otherwise null. Respects the enforce_entitlements
// kill-switch — when enforcement is off, this always returns null.

import { NextResponse } from "next/server";
import { checkFeature, getEntitlements } from "./entitlements";
import { accountState, type FeatureKey } from "./entitlement-registry";

export async function guardFeature(tenantId: string | null | undefined, feature: FeatureKey): Promise<NextResponse | null> {
  if (!tenantId) return null;
  const g = await checkFeature(tenantId, feature);
  if (g.ok) return null;
  return NextResponse.json(
    {
      error: `This feature isn't included in your current plan.${g.upgradeTo ? ` Upgrade to ${g.upgradeTo} to unlock it.` : ""}`,
      code: "feature_not_in_plan",
      feature,
      upgradeTo: g.upgradeTo,
    },
    { status: 402 },
  );
}

// Blocks mutating actions when the workspace isn't in good standing (suspended,
// past-due, or expired trial). Read-only by design — never deletes data. Returns
// null (allowed) when enforcement is off or the account is active.
export async function guardAccount(tenantId: string | null | undefined): Promise<NextResponse | null> {
  if (!tenantId) return null;
  const a = accountState(await getEntitlements(tenantId));
  if (a.active) return null;
  return NextResponse.json({ error: a.message, code: `account_${a.state}`, state: a.state }, { status: 402 });
}
