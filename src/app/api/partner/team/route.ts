import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { listPartnerUsers, invitePartnerUser, removePartnerUser, resendPartnerInvite } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

// GET — this partner's dashboard accounts.
export async function GET() {
  return withPartner(async ({ partner }) => NextResponse.json({ users: await listPartnerUsers(partner.id) }));
}

// POST { email, name, role } invites someone; { resend: userId } sends a fresh link. Owners only.
export async function POST(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ email?: string; name?: string; role?: string; resend?: string }>(req);
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const r = body.resend ? await resendPartnerInvite(partner, body.resend, user.email) : await invitePartnerUser(partner, body, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  }, { ownerOnly: true });
}

// DELETE { userId } — remove an account. Owners only; the last owner stays.
export async function DELETE(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ userId?: string }>(req);
    if (!body?.userId) return NextResponse.json({ error: "Choose who to remove." }, { status: 400 });
    if (body.userId === user.id) return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });
    const r = await removePartnerUser(partner.id, body.userId, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  }, { ownerOnly: true });
}
