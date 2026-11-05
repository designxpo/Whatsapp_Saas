import { NextResponse } from "next/server";
import { reviewViewer, visibleReview } from "@/lib/review-access";
import { updateCase, type CasePatch } from "@/lib/review-cases";
import { CASE_STATUSES, type CaseStatus } from "@/lib/reviews";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { id, assigneeId?, caseStatus?, followUpAt?, linkedContactId? } — work a
// review as a complaint case. Anyone who can see the review may change its
// status and follow-up date; assigning it and linking a CRM contact need an
// admin or lead. The public reply is not touched.
export async function POST(req: Request) {
  const v = await reviewViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const gate = await guardFeature(v.tenantId, "reviews");
  if (gate) return gate;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
  const review = await visibleReview(v, body.id);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  const patch: CasePatch = {};
  if ("assigneeId" in body || "linkedContactId" in body) {
    if (!v.canManage) return NextResponse.json({ error: "Only admins and team leads can assign reviews or link contacts." }, { status: 403 });
    if ("assigneeId" in body) patch.assigneeId = typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
    if ("linkedContactId" in body) patch.linkedContactId = typeof body.linkedContactId === "string" && body.linkedContactId ? body.linkedContactId : null;
  }
  if ("caseStatus" in body) {
    if (body.caseStatus !== null && !CASE_STATUSES.includes(body.caseStatus as CaseStatus)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    patch.caseStatus = body.caseStatus as CaseStatus | null;
  }
  if ("followUpAt" in body) patch.followUpAt = typeof body.followUpAt === "string" && body.followUpAt ? body.followUpAt : null;
  try {
    const r = await updateCase(v.tenantId, review.id, patch, { email: v.user.email, name: v.user.name });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json({ review: r.review });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
