import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getPartner, isPartnerSchemaMissing } from "@/lib/partners";
import { available, listLedger, ownerAdjust, afterFunding } from "@/lib/partner-billing";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const HINT = "Partner billing isn't set up in the database yet. Apply migration 20261030180000_partner_billing.sql in Supabase, then reload.";
const fail = (err: unknown) => isPartnerSchemaMissing(err) || /partner_ledger|balance_cents|billing_state/.test(errorMessage(err))
  ? NextResponse.json({ error: HINT, setupNeeded: true }, { status: 503 })
  : NextResponse.json({ error: errorMessage(err) }, { status: 500 });

// GET — a partner's balance, state and ledger. Owner only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const p = await getPartner((await params).id);
    if (!p) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    return NextResponse.json({
      balanceCents: p.balanceCents, depositCents: p.depositCents, availableCents: available(p),
      state: p.billingState, graceUntil: p.graceUntil, setupPaidAt: p.setupPaidAt, setupFeeCents: p.setupFeeCents,
      billingDay: p.billingDay, ledger: await listLedger(p.id, 50),
    });
  } catch (err) { return fail(err); }
}

// POST { amountCents, description } — a manual credit (e.g. a bank transfer)
// or debit. A credit then pays the setup fee / overdue month and resumes.
// POST { retry: true } — try the setup fee and an overdue month again.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const id = (await params).id;
    if (!(await getPartner(id))) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    const actor = (await currentUser())?.email ?? "owner";
    const body = await req.json().catch(() => ({})) as { amountCents?: number; description?: string; retry?: boolean };
    if (body.retry) { await afterFunding(id, new Date(), actor); return NextResponse.json({ ok: true }); }
    const r = await ownerAdjust(id, Math.round(Number(body.amountCents) || 0), body.description ?? "", actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
