import { NextResponse } from "next/server";
import { withPartner } from "@/lib/partner-api";
import { listPlans } from "@/lib/plans";
import { partnerWorkspaces } from "@/lib/partners";
import { monthlyEstimate } from "@/lib/partner-portal";
import { available, billingPeriod, listCustomerInvoices, listLedger, MIN_TOPUP_CENTS } from "@/lib/partner-billing";
import { partnerOrigin, whiteLabelConfig } from "@/lib/whitelabel";

export const dynamic = "force-dynamic";

// GET — the partner's balance, this period's bill, its history, its Razorpay
// connection (never the secrets) and the payment links sent to its customers.
export async function GET() {
  return withPartner(async ({ partner }) => {
    const now = new Date();
    const [plans, workspaces, ledger, invoices] = await Promise.all([listPlans(), partnerWorkspaces(partner.id), listLedger(partner.id), listCustomerInvoices(partner.id)]);
    const est = monthlyEstimate(partner, workspaces, plans);
    const period = billingPeriod(now, partner.billingDay);
    return NextResponse.json({
      balanceCents: partner.balanceCents, depositCents: partner.depositCents, availableCents: available(partner),
      setupFeeCents: partner.setupFeeCents, setupPaid: !!partner.setupPaidAt || partner.setupFeeCents === 0,
      state: partner.billingState, graceUntil: partner.graceUntil,
      billingDay: partner.billingDay, period: period.period, nextBillAt: period.end.toISOString(),
      estimateCents: est.totalCents, minTopupCents: MIN_TOPUP_CENTS,
      ledger, invoices,
      razorpay: partner.razorpay, customerBilling: partner.customerBilling,
      webhookUrl: `${partnerOrigin(partner.slug, whiteLabelConfig())}/api/webhooks/partner-razorpay/${partner.id}`,
    });
  });
}
