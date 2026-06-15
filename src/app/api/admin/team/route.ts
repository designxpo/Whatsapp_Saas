import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listUsers, saveUser, deleteUser, logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Team management is admin-only (owner or admin-role members).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    return NextResponse.json({ users: await listUsers(), owner: process.env.ADMIN_USER ?? null });
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
  // New seat → enforce the plan's team-seat limit.
  if (!body.id) {
    try { await enforceLimit((await currentTenantId()) ?? DEFAULT_TENANT_ID, "seats"); }
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
    });
    logActivity(await currentUser(), body.id ? "team.update" : "team.add", `${user.email} (${user.role})`);
    return NextResponse.json({ success: true, user });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — is migration 0014_team.sql applied?` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string; email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteUser(body.id);
    logActivity(await currentUser(), "team.remove", body.email ?? body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
