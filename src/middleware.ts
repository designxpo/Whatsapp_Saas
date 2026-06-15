import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "wa_admin_session";

async function valid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.ADMIN_JWT_SECRET ?? ""));
    return true;
  } catch {
    return false;
  }
}

// CSRF defense for cookie-authenticated, state-changing requests. Browsers
// always attach an Origin header on cross-origin (and same-origin non-GET)
// requests, so an Origin whose host differs from the request host is a forged
// cross-site request. Token-authenticated routes (webhooks, public API) don't
// use cookies and aren't reachable here.
function csrfBlocked(req: NextRequest): boolean {
  const m = req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;   // non-browser client (no ambient cookie CSRF vector)
  try {
    return new URL(origin).host !== (req.headers.get("host") ?? req.nextUrl.host);
  } catch {
    return true;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE)?.value;
  const ok = await valid(token);

  const isAdminApi = pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";
  const isOwnerApi = pathname.startsWith("/api/owner");

  // Cookie-authenticated APIs → CSRF check, then auth gate (401 JSON).
  if (isAdminApi || isOwnerApi) {
    if (csrfBlocked(req)) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.next();
  }

  // Admin pages → redirect to login.
  if (pathname.startsWith("/admin")) {
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/api/owner/:path*"] };
