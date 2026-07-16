import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { getCannedTemplates, setCannedTemplates, type Canned } from "@/lib/canned";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET — the workspace's canned templates (RNR, post-call follow-up, …). Read by
// the Live Chat composer (to render one-click buttons) and the Settings editor.
export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ canned: await getCannedTemplates(tid) });
}

// POST { canned: Canned[] } — replace the list. Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { canned?: Canned[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.canned)) return NextResponse.json({ error: "canned array required" }, { status: 400 });
  await setCannedTemplates(tid, body.canned);
  logActivity(await currentUser(), "canned.save", `${body.canned.length} template(s)`);
  return NextResponse.json({ canned: await getCannedTemplates(tid) });
}
