import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "wa_admin_session";

async function valid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  // Mirror auth.ts: HS256 needs a ≥32-byte key. A missing/short secret can't be
  // trusted, so fail closed here too instead of verifying against "" — keeps the
  // two auth layers from diverging on minimum-secret enforcement.
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(s));
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

// Stops the browser caching authenticated pages (and the login page) in its
// disk / back-forward cache. Without this, the Back button can resurface the
// cached dashboard after sign-out, or show the cached sign-in form even though
// the user is already authenticated.
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
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

  // Sign-in page: already authenticated → bounce to the dashboard (handles the
  // Back button landing on a cached login form). Always no-store so Back forces
  // a revalidation through this check instead of replaying a cached page.
  if (pathname === "/login") {
    if (ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      return noStore(NextResponse.redirect(url));
    }
    return noStore(NextResponse.next());
  }

  // Admin pages → must be authenticated, and must never be cached so Back/Forward
  // can't resurface the dashboard after the session ends.
  if (pathname.startsWith("/admin")) {
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return noStore(NextResponse.redirect(url));
    }
    return noStore(NextResponse.next());
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/login", "/api/admin/:path*", "/api/owner/:path*"] };
