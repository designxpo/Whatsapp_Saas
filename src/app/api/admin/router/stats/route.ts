import { NextResponse } from "next/server";
import { getRouterStats } from "@/lib/router/metrics";
import { faqCount } from "@/lib/router/faq";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — Knowledge Router hit rates, latency, and token savings (?days=7).
export async function GET(req: Request) {
  const days = Math.min(90, Math.max(1, parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10) || 7));
  try {
    const stats = await getRouterStats(days);
    return NextResponse.json({ ...stats, faqEntries: faqCount() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
