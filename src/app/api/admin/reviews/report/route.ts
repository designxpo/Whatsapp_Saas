import { NextResponse } from "next/server";
import { reviewViewer } from "@/lib/review-access";
import { reviewReport, METRIC_DEFINITIONS } from "@/lib/review-reports";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&location= — the reviews dashboard: Google's
// own rating and totals, the period's reviews, replies and backlog, review
// requests, weekly trend, recorded rating history and feedback themes. Team
// members only see their own locations.
export async function GET(req: Request) {
  const v = await reviewViewer();
  if (!v) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const gate = await guardFeature(v.tenantId, "reviews");
  if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const to = ISO_DAY.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const from = ISO_DAY.test(sp.get("from") ?? "") ? sp.get("from")! : new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (from > to) return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return NextResponse.json({ error: "Choose a period of a year or less." }, { status: 400 });
  const location = sp.get("location");
  if (location && v.allowed && !v.allowed.includes(location)) return NextResponse.json({ error: "Location not found" }, { status: 404 });
  try {
    const report = await reviewReport(v.tenantId, { from, to, location: location || null, channelIds: v.allowed });
    return NextResponse.json({ report, definitions: METRIC_DEFINITIONS, canExport: v.user.role === "admin" });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
