import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { rateLimit, apiPerKey } from "@/lib/ratelimit";
import { guardFeature } from "@/lib/feature-guard";
import { getTenant } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// GET /api/integrations/mezmitra/ping — Mezvaan's "Test connection". Confirms
// the API key Mezvaan holds still works and the plan still includes the link,
// without sending anything to anyone. Auth: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const rl = await rateLimit(`api:${tenantId}`, apiPerKey());
  if (!rl.allowed) return NextResponse.json({ ok: false, error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const gate = await guardFeature(tenantId, "restaurant_link"); if (gate) return gate;
  const tenant = await getTenant(tenantId).catch(() => null);
  return NextResponse.json({ ok: true, workspace: tenant?.name ?? "Your workspace" });
}
