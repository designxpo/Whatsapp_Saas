import { NextResponse } from "next/server";
import { reviewViewer, visibleReview } from "@/lib/review-access";
import { listActivity, addNote } from "@/lib/review-cases";
import { guardFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// GET ?id= — a review's private notes and the history of its case.
export async function GET(req: Request) {
  const v = await reviewViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const gate = await guardFeature(v.tenantId, "reviews");
  if (gate) return gate;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await visibleReview(v, id))) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  return NextResponse.json({ activity: await listActivity(v.tenantId, id) });
}

// POST { id, body } — add a private note. Notes are internal: never posted
// anywhere, never shown to the customer.
export async function POST(req: Request) {
  const v = await reviewViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const gate = await guardFeature(v.tenantId, "reviews");
  if (gate) return gate;
  let body: { id?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id || !(await visibleReview(v, body.id))) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  const r = await addNote(v.tenantId, body.id, String(body.body ?? ""), { email: v.user.email, name: v.user.name });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ activity: await listActivity(v.tenantId, body.id) });
}
