import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { eraseContact } from "@/lib/gdpr";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { phone } — erase a contact and all their personal data (right to be
// forgotten). Admin-only, scoped to the caller's tenant.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone?.trim()) return NextResponse.json({ error: "phone required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const result = await eraseContact(tid, body.phone.trim());
    const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
    logActivity(await currentUser(), "gdpr.erase", `${result.phone} (${total} rows)`);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
