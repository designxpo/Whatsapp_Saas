import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser, createSession, SESSION_COOKIE } from "@/lib/auth";
import { getTenant, ownerAudit } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// POST { tenantId } — view a tenant's workspace for support. Re-mints the
// owner's session scoped to that tenant. POST { reset: true } returns home.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  let body: { tenantId?: string; reset?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // reset → back to the owner's own (default) tenant.
  const targetTenant = body.reset ? "00000000-0000-0000-0000-000000000001" : body.tenantId;
  if (!targetTenant) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  if (!body.reset) {
    const t = await getTenant(targetTenant);
    if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    await ownerAudit(me.email, "impersonate", targetTenant, t.name);
  }

  // Owner sessions must carry the owner epoch — verifySession rejects any other
  // value, so omitting it here would break impersonation once the epoch is bumped.
  const token = await createSession({ email: me.email, name: body.reset ? "Owner" : "Owner (support)", role: "admin", tenantId: targetTenant, tokenVersion: Number(process.env.ADMIN_TOKEN_EPOCH ?? "0") || 0 });
  const res = NextResponse.json({ success: true, tenantId: targetTenant });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return res;
}
