import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { supportDeskTenantId } from "@/lib/supportdesk";
import { listUsers, saveUser, deleteUser, logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// ?desk=support → manage the SUPPORT workspace's team (owner sessions only hop;
// team members resolve to their own session tenant regardless of the flag).
function teamTenant(req: Request): Promise<string | null> {
  return new URL(req.url).searchParams.get("desk") === "support" ? supportDeskTenantId() : currentTenantId();
}

// Team management is admin-only (owner or admin-role members).
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await teamTenant(req)) ?? DEFAULT_TENANT_ID;
    // The env owner account belongs to the platform's OWN workspace only — never
    // expose the operator's email to a tenant. Only the default workspace sees it.
    const owner = tid === DEFAULT_TENANT_ID ? (process.env.ADMIN_USER ?? null) : null;
    return NextResponse.json({ users: await listUsers(tid), owner });
  } catch (err) {
    return NextResponse.json({ users: [], notice: errorMessage(err) });
  }
}

// POST — create/update a member. Body: { id?, email, name, role, password?, active? }
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; email?: string; name?: string; title?: string; role?: "admin" | "member"; password?: string; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.email?.trim()) return NextResponse.json({ error: "email required" }, { status: 400 });
  const tid = (await teamTenant(req)) ?? DEFAULT_TENANT_ID;
  // New seat → enforce the plan's team-seat limit.
  if (!body.id) {
    try { await enforceLimit(tid, "seats"); }
    catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }
  }
  try {
    const user = await saveUser({
      id: body.id,
      email: body.email,
      name: body.name ?? "",
      title: body.title ?? "",
      role: body.role === "admin" ? "admin" : "member",
      password: body.password,
      active: body.active,
    }, tid);
    logActivity(await currentUser(), body.id ? "team.update" : "team.add", `${user.email} (${user.role})`);
    return NextResponse.json({ success: true, user });
  } catch (err) {
    const msg = errorMessage(err);
    // wa_users.email is unique across ALL workspaces — surface that plainly
    // instead of the misleading migration hint (a 23505 is not a schema gap).
    if (/duplicate key|23505/i.test(msg) && /email/i.test(msg)) {
      return NextResponse.json({ error: "A member with this email already exists (here or in another workspace) — every member email must be unique across Talko AI." }, { status: 409 });
    }
    return NextResponse.json({ error: `${msg} — is migration 0014_team.sql applied?` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteUser(body.id, (await teamTenant(req)) ?? DEFAULT_TENANT_ID);
    logActivity(await currentUser(), "team.remove", body.email ?? body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
