import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getPartner, isPartnerSchemaMissing } from "@/lib/partners";
import { listPartnerUsers, invitePartnerUser, removePartnerUser, resendPartnerInvite } from "@/lib/partner-portal";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const SETUP_HINT = "Partner dashboards aren't set up in the database yet. Apply migration 20261030160000_partner_dashboard.sql in Supabase, then reload.";

async function guard(id: string) {
  if (!(await isPlatformOwner())) return { res: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  const partner = await getPartner(id);
  if (!partner) return { res: NextResponse.json({ error: "Partner not found" }, { status: 404 }) };
  return { partner, actor: (await currentUser())?.email ?? "owner" };
}

function fail(err: unknown) {
  if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: SETUP_HINT, setupNeeded: true }, { status: 503 });
  return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
}

// GET — this partner's dashboard accounts. Owner only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard((await params).id);
    if ("res" in g) return g.res;
    return NextResponse.json({ users: await listPartnerUsers(g.partner.id) });
  } catch (err) { return fail(err); }
}

// POST { email, name } invites an owner; { resend: userId } sends a fresh link.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard((await params).id);
    if ("res" in g) return g.res;
    const body = await req.json().catch(() => ({})) as { email?: string; name?: string; resend?: string };
    const r = body.resend
      ? await resendPartnerInvite(g.partner, body.resend, g.actor)
      : await invitePartnerUser(g.partner, { email: body.email, name: body.name, role: "owner" }, g.actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}

// DELETE { userId } — remove a dashboard account.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard((await params).id);
    if ("res" in g) return g.res;
    const body = await req.json().catch(() => ({})) as { userId?: string };
    if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const r = await removePartnerUser(g.partner.id, body.userId, g.actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
