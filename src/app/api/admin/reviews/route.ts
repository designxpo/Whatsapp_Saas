import { NextResponse } from "next/server";
import { listReviews, saveReview, deleteReview, getReviewSettings } from "@/lib/reviews";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's reviews + reply settings.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const [reviews, settings] = await Promise.all([listReviews(tid), getReviewSettings(tid)]);
    return NextResponse.json({ reviews, settings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — create or update a review (manual add in Phase 1).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const text = String(body.text ?? "").trim();
  const author = String(body.author ?? "").trim();
  if (!text && !author) return NextResponse.json({ error: "Add the reviewer's name or the review text" }, { status: 400 });
  try {
    const review = await saveReview({
      id: typeof body.id === "string" ? body.id : undefined,
      source: "manual",
      locationName: (body.locationName as string | null) ?? null,
      author,
      rating: Number(body.rating ?? 5),
      text,
    }, tid);
    logActivity(await currentUser(), "settings.save", `review from "${review.author || "anon"}" (${review.rating}★)`);
    return NextResponse.json({ review });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove a review by id (scoped to this tenant).
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteReview(body.id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
