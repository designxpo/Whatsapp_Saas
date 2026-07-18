import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "wa_admin_session";

// ── Host split: marketing site vs app portal on one deployment ───────────────
// Both hosts point at this single Vercel project. Set these to the bare
// hostnames (no scheme) to turn the split on:
//   NEXT_PUBLIC_APP_HOST=app.example.com     ← signup / login / portal live here
//   NEXT_PUBLIC_MARKETING_HOST=example.com   ← the public marketing site lives here
// When either is unset, or the request host is neither (localhost, *.vercel.app
// preview URLs), the split is a NO-OP and every route is served on the one host.
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST;
const MARKETING_HOST = process.env.NEXT_PUBLIC_MARKETING_HOST;

// Portal PAGE paths — served ONLY on the app host.
function isPortalPage(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/signup"
    || pathname.startsWith("/admin")
    || pathname.startsWith("/support")
    || pathname.startsWith("/crm");
}

// Machine/public paths that must resolve on BOTH hosts, never host-blocked:
// all APIs (Meta webhooks, the embeddable web-chat widget, the bearer-token
// public API, cron) and the public short-links printed on QR codes / campaign
// messages (/g, /r). Their own auth/CSRF gates below still apply.
function isSharedPath(pathname: string): boolean {
  return pathname.startsWith("/api")
    || pathname.startsWith("/g/")
    || pathname.startsWith("/r/");
}

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

  // ── Host split (runs before auth). Only when both hosts are configured AND the
  // request is actually on one of them — otherwise a no-op so localhost/preview
  // keep serving everything on a single host. Shared machine/public paths are
  // exempt so webhooks, the widget and QR/campaign short-links work on both. ──
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const splitOn = !!APP_HOST && !!MARKETING_HOST
    && (host === APP_HOST || host === MARKETING_HOST || host === `www.${MARKETING_HOST}`);
  if (splitOn && !isSharedPath(pathname)) {
    if (host === APP_HOST) {
      // App host front door → into the portal (dashboard if signed in, else login).
      if (pathname === "/") {
        const url = req.nextUrl.clone();
        url.pathname = ok ? "/admin" : "/login";
        return noStore(NextResponse.redirect(url));
      }
      // Marketing pages don't exist on the app host.
      if (!isPortalPage(pathname)) return new NextResponse("Not found", { status: 404 });
    } else {
      // Marketing host. /login and /signup are the PUBLIC entry points the
      // marketing CTAs (header, footer, hero, pricing) link to — redirect those
      // to the app host so the conversion flow works, instead of 404ing it.
      // Query strings (e.g. ?plan=growth, ?next=) are preserved.
      if (pathname === "/login" || pathname === "/signup") {
        const url = new URL(`https://${APP_HOST}${pathname}${req.nextUrl.search}`);
        return NextResponse.redirect(url);
      }
      // Deeper portal pages don't exist on the marketing host.
      if (isPortalPage(pathname)) return new NextResponse("Not found", { status: 404 });
    }
  }

  const isAdminApi = pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";
  const isOwnerApi = pathname.startsWith("/api/owner");
  // Support Desk APIs are cookie-authenticated too (profile/password updates) —
  // they need the same CSRF + auth gate as the admin APIs.
  const isSupportApi = pathname.startsWith("/api/support");

  // Cookie-authenticated APIs → CSRF check, then auth gate (401 JSON).
  if (isAdminApi || isOwnerApi || isSupportApi) {
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
  if (pathname.startsWith("/admin") || pathname.startsWith("/support")) {
    if (!ok) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      // Preserve the destination so login can land the user back where they
      // were heading (the login page only honors same-origin relative paths).
      url.search = pathname !== "/admin" ? `?next=${encodeURIComponent(pathname)}` : "";
      return noStore(NextResponse.redirect(url));
    }
    return noStore(NextResponse.next());
  }
  return NextResponse.next();
}

// Run on every request EXCEPT Next internals and static files (anything with a
// file extension). The host split needs to see marketing pages, /signup and the
// app-host root; the auth/CSRF gate still only ACTS on the portal + cookie-API
// paths and falls through to next() for everything else.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"] };
