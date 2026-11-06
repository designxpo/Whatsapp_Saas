import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { documentsToReview, setReviewBy } from "@/lib/kb-review";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — documents that may be out of date.
export async function GET() {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  try { return NextResponse.json(await documentsToReview(g.tid)); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { docId, reviewBy: "YYYY-MM-DD" | null }
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let b: { docId?: unknown; reviewBy?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof b.docId !== "string") return NextResponse.json({ error: "docId required" }, { status: 400 });
  const r = await setReviewBy(g.tid, b.docId, typeof b.reviewBy === "string" ? b.reviewBy : null);
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json({ ok: true });
}
