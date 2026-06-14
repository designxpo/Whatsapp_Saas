import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { searchTargeting, geocodePlaces } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET ?kind=geo|interest|locale|place&q= — live targeting search for the builder.
// kind=place geocodes an address/point (for pinned-radius targeting).
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kindRaw = url.searchParams.get("kind") ?? "geo";
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  if (kindRaw === "place") return NextResponse.json({ results: await geocodePlaces(q) });
  const kind = kindRaw === "interest" ? "interest" : kindRaw === "locale" ? "locale" : "geo";
  return NextResponse.json({ results: await searchTargeting(kind, q) });
}
