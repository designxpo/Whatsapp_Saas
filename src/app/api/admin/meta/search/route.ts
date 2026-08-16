import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
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

  // Place search is OpenStreetMap, not Meta — no tenant token involved.
  if (kindRaw === "place") return NextResponse.json({ results: await geocodePlaces(q) });
  const kind = kindRaw === "interest" ? "interest" : kindRaw === "locale" ? "locale" : "geo";
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  return NextResponse.json({ results: await searchTargeting(kind, q, tid) });
}
