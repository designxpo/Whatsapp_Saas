import { NextResponse } from "next/server";
import { openReviewLink } from "@/lib/review-booster";

export const dynamic = "force-dynamic";

// A review request's tracked link: count the open, then on to the Google review page.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const url = await openReviewLink((await params).token).catch(() => null);
  return url ? NextResponse.redirect(url, 302) : new NextResponse("This link has expired.", { status: 404 });
}
