import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { eraseContact } from "@/lib/gdpr";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { phone } — erase a person and all their personal data (right to be
// forgotten). `phone` is whatever identifies them: a phone number, an
// Instagram/Messenger/web-chat id, or a conversation id. Admin-only, scoped to
// the caller's tenant. Orders are anonymised rather than deleted (tax records).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { phone?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const who = (body.phone ?? body.id ?? "").trim();
  if (!who) return NextResponse.json({ error: "phone required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const result = await eraseContact(tid, who);
    const total = Object.values(result.deleted).reduce((a, b) => a + b, 0);
    logActivity(await currentUser(), "gdpr.erase", `${result.phone} (${total} rows deleted, ${result.anonymised.wa_orders ?? 0} orders anonymised)`);
    return NextResponse.json({ success: result.errors.length === 0, ...result });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
