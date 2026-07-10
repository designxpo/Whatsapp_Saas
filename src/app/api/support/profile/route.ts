import { NextResponse } from "next/server";
import { currentUser, createSession, SESSION_COOKIE } from "@/lib/auth";
import { listUsers, saveUser, logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Self-service profile for the Support Desk. Strictly scoped to the CURRENT
// session user: role and email can never change here, and no other user's row
// is ever touched. Tenant comes from the session — never from the request.

// Find the caller's own wa_users row inside their session tenant.
async function ownRow(email: string, tenantId: string) {
  const users = await listUsers(tenantId);
  return users.find(u => u.email === email.trim().toLowerCase()) ?? null;
}

// GET — who am I: { email, name, title, role }.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const row = await ownRow(user.email, user.tenantId);
    return NextResponse.json({
      user: { email: user.email, name: row?.name || user.name || user.email, title: row?.title ?? "", role: user.role },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — update ONLY the caller's own name / title / password.
// Body: { name?, title?, password? } — role/email/active in the body are ignored.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { name?: string; title?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const row = await ownRow(user.email, user.tenantId);
    // The env owner account has no wa_users row — nothing editable here.
    if (!row) return NextResponse.json({ error: "This account has no editable profile (owner accounts are managed in the environment)." }, { status: 400 });

    const password = (body.password ?? "").trim();
    if (password && password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    // Name can't be blanked (it's the assignee label); title may be cleared.
    const name = (typeof body.name === "string" ? body.name.trim() : row.name) || row.name || user.email;
    const title = typeof body.title === "string" ? body.title.trim() : row.title;

    // Role, email and active status are pinned to the caller's own row.
    const saved = await saveUser({
      id: row.id, email: row.email, name, title,
      role: row.role, active: row.active,
      password: password || undefined,
    }, user.tenantId);
    logActivity(user, "profile.update", password ? "name/title + password" : "name/title");

    // A password change bumps token_version (revoking every other session), and a
    // name change lives in the JWT — re-issue THIS session's cookie so the caller
    // stays signed in with fresh claims instead of being bounced to /login.
    const token = await createSession({ email: saved.email, name: saved.name || saved.email, role: saved.role, tenantId: user.tenantId, tokenVersion: saved.tokenVersion });
    const res = NextResponse.json({ success: true, user: { email: saved.email, name: saved.name, title: saved.title, role: saved.role } });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
