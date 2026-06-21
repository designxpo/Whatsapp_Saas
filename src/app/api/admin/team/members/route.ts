import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listUsers } from "@/lib/team";

export const dynamic = "force-dynamic";

// Lightweight assignee directory for the Live Chat "Assigned to" picker.
// Any signed-in user (admin or member) can read it — names and titles only,
// never password hashes or login history.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const users = await listUsers(tid);
  const members = users
    .filter(u => u.active)
    .map(u => ({ name: u.name || u.email, email: u.email, title: u.title, role: u.role }));
  // Only the platform's own workspace lists the env owner as an assignee — a
  // tenant must never see the operator's email.
  const owner = tid === DEFAULT_TENANT_ID ? process.env.ADMIN_USER : null;
  if (owner && !members.some(m => m.email === owner)) {
    members.unshift({ name: owner, email: owner, title: "Owner", role: "admin" });
  }
  return NextResponse.json({ members });
}
