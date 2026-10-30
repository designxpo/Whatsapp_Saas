import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { setResalePrices } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

// PATCH { prices: { planKey: cents } } — a reseller's own monthly prices, never
// below Talko's list price. Owners only.
export async function PATCH(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ prices?: unknown }>(req);
    const r = await setResalePrices(partner, body?.prices, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ prices: r.prices });
  }, { ownerOnly: true });
}
