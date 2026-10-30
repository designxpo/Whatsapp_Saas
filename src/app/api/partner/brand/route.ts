import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { updatePartner } from "@/lib/partners";
import type { BrandSettings } from "@/lib/whitelabel";

export const dynamic = "force-dynamic";

// PATCH { brand } — what this partner's customers see. Owners only, and only
// the brand: prices, plans and status stay with Talko.
export async function PATCH(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ brand?: BrandSettings }>(req);
    if (!body?.brand) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const r = await updatePartner(partner.id, { brand: body.brand }, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ brand: r.partner?.brand ?? {} });
  }, { ownerOnly: true });
}
