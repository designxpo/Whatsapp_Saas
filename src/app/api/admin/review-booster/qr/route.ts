import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getRequestConfig, resolveReviewUrl, checkReviewUrl } from "@/lib/review-booster";
import { getChannelSync } from "@/lib/reviews";
import { getChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

// GET ?location=<id> — a QR code (PNG) for a location's Google review page, to
// print for the counter, a table tent or a receipt. It opens Google directly;
// scans aren't tracked. Without ?location, the review link from Review requests.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Workspace required" }, { status: 401 });
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  const loc = new URL(req.url).searchParams.get("location");
  let url = "";
  if (loc) {
    const ch = await getChannel(loc, tid);
    if (!ch || ch.kind !== "google_reviews") return NextResponse.json({ error: "Location not found" }, { status: 404 });
    url = (await getChannelSync(tid, ch.id)).reviewUri ?? "";
  } else {
    url = await resolveReviewUrl(tid, await getRequestConfig(tid));
  }
  if (!url || !checkReviewUrl(url).ok) return NextResponse.json({ error: "No Google review link for this location yet. It appears after the location's first sync, or paste one in Review requests." }, { status: 404 });
  const png = await QRCode.toBuffer(url, { width: 900, margin: 2, errorCorrectionLevel: "M" });
  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="google-review-qr.png"` } });
}
