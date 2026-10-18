import { NextResponse } from "next/server";
import { resolveGrowthRedirect } from "@/lib/growth";
import { safeRedirectTarget } from "@/lib/links";

export const dynamic = "force-dynamic";

// GET /g/<slug> — public growth link. Counts the click and 302-redirects to the
// WhatsApp/Instagram opt-in deep link with the prefilled message.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = safeRedirectTarget(await resolveGrowthRedirect(slug).catch(() => null));
  if (!url) return new NextResponse("Link not found", { status: 404 });
  return NextResponse.redirect(url, 302);
}
