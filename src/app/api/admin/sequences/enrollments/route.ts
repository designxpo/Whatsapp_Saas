import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listRecentEnrollments } from "@/lib/sequences";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's recent enrollments (who's in a drip, which step, when it
// next runs, any error). Powers the Sequences monitor. Admin only.
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    return NextResponse.json({ enrollments: await listRecentEnrollments(100, tid) });
  } catch (err) {
    return NextResponse.json({ enrollments: [], error: errorMessage(err) });
  }
}
