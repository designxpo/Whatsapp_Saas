import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/team";

export const dynamic = "force-dynamic";

// Lightweight assignee directory for the Live Chat "Assigned to" picker.
// Any signed-in user (admin or member) can read it — names and titles only,
// never password hashes or login history.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const users = await listUsers();
  const members = users
    .filter(u => u.active)
    .map(u => ({ name: u.name || u.email, email: u.email, title: u.title, role: u.role }));
  const owner = process.env.ADMIN_USER;
  if (owner && !members.some(m => m.email === owner)) {
    members.unshift({ name: owner, email: owner, title: "Owner", role: "admin" });
  }
  return NextResponse.json({ members });
}
