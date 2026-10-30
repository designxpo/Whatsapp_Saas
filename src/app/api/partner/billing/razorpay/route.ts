import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { savePartnerRazorpay } from "@/lib/partner-billing";

export const dynamic = "force-dynamic";

// PUT { keyId, keySecret, webhookSecret } — connect the partner's own Razorpay
// for billing its customers. Checked against Razorpay, stored encrypted. Owners only.
export async function PUT(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ keyId?: string; keySecret?: string; webhookSecret?: string }>(req);
    const r = await savePartnerRazorpay(partner, body ?? {}, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  }, { ownerOnly: true });
}
