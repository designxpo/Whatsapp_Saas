import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { getTenant } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// GET /api/whoami — a tiny, side-effect-free identity check for API-key clients
// (the browser extension, integrations, scripts). Confirms a key is valid and
// tells the caller which workspace it belongs to, so a tool can show "Connected
// to <workspace>" instead of guessing. Auth: Authorization: Bearer <ak_live_… key>.
export async function GET(req: Request) {
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  // Best-effort friendly name; a valid key still returns ok even if the lookup fails.
  const tenant = await getTenant(tenantId).catch(() => null);
  return NextResponse.json({
    ok: true,
    tenantId,
    workspace: tenant?.name ?? tenant?.company ?? "Your workspace",
    plan: tenant?.plan ?? null,
  });
}
