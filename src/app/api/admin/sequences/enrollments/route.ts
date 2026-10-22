import { NextRequest, NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listRecentEnrollments } from "@/lib/sequences";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's enrollments, a page at a time (who's in a drip, which
// step, when it next runs, any error). Powers the Sequences monitor. Admin only.
//
// Query params:
//   limit      – page size, 1–100, default 50
//   offset     – zero-based row offset, default 0
//   sequenceId – one journey, or "all"
//   status     – "all" | "active" | "completed" | "stopped" | "failed"
//   platform   – "all" | "whatsapp" | "instagram"
//   search     – substring of the phone / IGSID
//   range      – "all" | "today" | "7d" | "14d" | "30d" | "90d"
export async function GET(req: NextRequest) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

    const { data, total } = await listRecentEnrollments(limit, tid, offset, {
      sequenceId: url.searchParams.get("sequenceId") || undefined,
      status: url.searchParams.get("status") || undefined,
      platform: url.searchParams.get("platform") || undefined,
      search: url.searchParams.get("search") || undefined,
      range: url.searchParams.get("range") || undefined,
    });
    return NextResponse.json({ enrollments: data, total });
  } catch (err) {
    return NextResponse.json({ enrollments: [], total: 0, error: errorMessage(err) });
  }
}
