import { NextResponse } from "next/server";
import { listOptouts, addOptout, removeOptout } from "@/lib/store";
import { currentUser, currentTenantId, requireRoleAdmin, noSession } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return noSession();
  return NextResponse.json({ optouts: await listOptouts(tid) });
}

export async function POST(req: Request) {
  let body: { phone?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone?.trim()) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  await addOptout(body.phone.trim(), body.reason, tid);
  logActivity(await currentUser(), "optout.add", body.phone.trim());
  return NextResponse.json({ success: true });
}

// DELETE — take someone OFF the Do Not Contact list, i.e. start messaging a
// person who said stop. A compliance decision, so admins only. Adding someone
// (POST) stays open to every member: suppressing is always the safe direction.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone?.trim()) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  await removeOptout(body.phone.trim(), tid);
  logActivity(await currentUser(), "optout.remove", body.phone.trim());
  return NextResponse.json({ success: true });
}
