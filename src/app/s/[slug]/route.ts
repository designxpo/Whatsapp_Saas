import { NextResponse, after } from "next/server";
import { resolveShortLink, recordShortClick, bridgeUrl } from "@/lib/handlehub";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
 const { slug } = await params;
 const target = await resolveShortLink(slug);
 if (!target) return new Response("Link not found", { status: 404 });
 const url = new URL(req.url);
 const dest = new URL(bridgeUrl(url.origin, target.source));
 for (const [k,v] of url.searchParams) if (/^(utm_(source|medium|campaign|term|content)|gclid|fbclid|sclx_id)$/.test(k)) dest.searchParams.set(k,v);
 after(() => recordShortClick(target.source.id));
 const res = NextResponse.redirect(dest, 302);
 // The target is recomputed from the source on every request, so an edit to the
 // greeting or the number reaches links that are already printed. A cached 302
 // would defeat exactly that, so say so rather than trusting a default.
 res.headers.set("Cache-Control", "no-store, max-age=0");
 return res;
}
