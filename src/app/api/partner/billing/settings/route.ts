import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { saveCustomerBilling } from "@/lib/partner-billing";
import type { CustomerBilling } from "@/lib/partners";

export const dynamic = "force-dynamic";

// PATCH { autoLinks, graceDays, autoPause } — how the partner bills its customers. Owners only.
export async function PATCH(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<Partial<CustomerBilling>>(req);
    const r = await saveCustomerBilling(partner, body ?? {}, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ customerBilling: r.v });
  }, { ownerOnly: true });
}
