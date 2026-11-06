import { NextResponse } from "next/server";
import { syncTenantGoogleReviews } from "@/lib/reviewpoller";
import { currentTenantId, requireRoleAdmin, noSession } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // a deep read plus AI drafts for any new recent reviews

// POST — fetch this workspace's Google reviews now (new ones, edits, and
// replies changed on Google), instead of waiting for the next scheduled import.
export async function POST() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return noSession();
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  try {
    return NextResponse.json(await syncTenantGoogleReviews(tid));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
