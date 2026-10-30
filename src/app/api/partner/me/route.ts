import { NextResponse } from "next/server";
import { withPartner } from "@/lib/partner-api";
import { listPlans } from "@/lib/plans";
import { partnerWorkspaces } from "@/lib/partners";
import { monthlyEstimate } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

// GET — the signed-in staff member, their partner (the fields a partner may
// see: never notes or Talko-side settings), its plans and this month's estimate.
export async function GET() {
  return withPartner(async ({ user, partner, brand }) => {
    const [plans, workspaces] = await Promise.all([listPlans(), partnerWorkspaces(partner.id)]);
    const sellable = plans.filter(p => partner.allowedPlans.includes(p.key))
      .map(p => ({ key: p.key, name: p.name, listCents: p.priceCents, limits: p.limits }));
    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      partner: {
        id: partner.id, name: partner.name, slug: partner.slug, kind: partner.kind, tier: partner.tier, status: partner.status,
        monthlyFeeCents: partner.monthlyFeeCents, wholesalePct: partner.wholesalePct, graceDays: partner.graceDays,
        brand: partner.brand, resalePrices: partner.resalePrices,
        billingState: partner.billingState, graceUntil: partner.graceUntil,
        setupPaid: !!partner.setupPaidAt || partner.setupFeeCents === 0,
        availableCents: partner.balanceCents - partner.depositCents,
      },
      brand,
      plans: sellable,
      estimate: monthlyEstimate(partner, workspaces, plans),
    });
  });
}
