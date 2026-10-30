import { NextResponse } from "next/server";
import { createPartnerSession, PARTNER_SESSION_COOKIE } from "@/lib/auth";
import { acceptPartnerInvite } from "@/lib/partner-portal";
import { brandForHost } from "@/lib/brand-lookup";
import { readJson } from "@/lib/partner-api";

export const dynamic = "force-dynamic";

// POST { token, password } — accept an invitation: set the password and sign in.
// The invitation must belong to the partner whose address this is.
export async function POST(req: Request) {
  const here = (await brandForHost(req.headers.get("host"))).brand;
  if (!here?.partnerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readJson<{ token?: string; password?: string }>(req);
  const r = await acceptPartnerInvite(body?.token ?? "", body?.password ?? "", here.partnerId).catch(() => ({ error: "Something went wrong. Try again." }) as { error: string });
  if ("error" in r && r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  const ok = r as { user: { id: string; email: string }; tokenVersion: number; partnerId: string };
  const token = await createPartnerSession({ userId: ok.user.id, partnerId: ok.partnerId, email: ok.user.email, tokenVersion: ok.tokenVersion });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PARTNER_SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
