import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { createTopup } from "@/lib/partner-billing";

export const dynamic = "force-dynamic";

// POST { amountCents } — a Razorpay payment link to add money. Owners only.
export async function POST(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ amountCents?: number }>(req);
    const r = await createTopup(partner, Math.round(Number(body?.amountCents) || 0), { email: user.email, name: user.name });
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ url: r.url });
  }, { ownerOnly: true });
}
