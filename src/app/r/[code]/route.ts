import { NextResponse } from "next/server";
import { registerClick, siteUrl } from "@/lib/links";

export const dynamic = "force-dynamic";

// GET /r/<code> — tracked short link from a template URL button.
// Registers the click and 302-redirects to the original target URL.
// Unknown/expired codes land on the site home instead of erroring.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = code ? await registerClick(code) : null;
  return NextResponse.redirect(target || siteUrl(), 302);
}
