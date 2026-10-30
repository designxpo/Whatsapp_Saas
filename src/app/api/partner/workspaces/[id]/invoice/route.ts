import { NextResponse } from "next/server";
import { withPartner } from "@/lib/partner-api";
import { sendCustomerInvoice } from "@/lib/partner-billing";

export const dynamic = "force-dynamic";

// POST — send this month's payment link to one of the partner's customers
// (through the partner's own Razorpay), or show the one already sent.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPartner(async ({ partner, user }) => {
    const r = await sendCustomerInvoice(partner, id, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
  });
}
