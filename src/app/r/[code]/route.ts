import { NextResponse } from "next/server";
import { registerClick, siteUrl, safeRedirectTarget } from "@/lib/links";

export const dynamic = "force-dynamic";

// GET /r/<code> — tracked short link from a template URL button.
// Registers the click and 302-redirects to the original target URL.
// Unknown/expired codes land on the site home instead of erroring.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = code ? await registerClick(code) : null;
  // Only http(s) targets are followed: the value is tenant-supplied and this is
  // a redirector on the production domain every template links to.
  return NextResponse.redirect(safeRedirectTarget(target) || siteUrl(), 302);
}
