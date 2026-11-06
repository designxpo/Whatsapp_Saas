import { NextResponse } from "next/server";
import { openReviewLink } from "@/lib/review-booster";
import { safeRedirectTarget } from "@/lib/links";

export const dynamic = "force-dynamic";

// A review request's tracked link: count the open, then on to the review page.
// The target is tenant-set (usually Google, but any review site is allowed), so
// it goes through the same http(s)-only check as /r/<code>: this redirector is
// on the production domain, and a javascript:/data: target must never be followed.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const url = safeRedirectTarget(await openReviewLink((await params).token).catch(() => null));
  return url ? NextResponse.redirect(url, 302) : new NextResponse("This link has expired.", { status: 404 });
}
