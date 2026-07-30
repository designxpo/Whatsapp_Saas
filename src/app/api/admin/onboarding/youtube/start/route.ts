import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { checkFeature } from "@/lib/entitlements";
import { youtubeConfigured } from "@/lib/youtube";

export const dynamic = "force-dynamic";

const YT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const STATE_COOKIE = "yt_oauth_state";

// Same fallback as the billing routes: prefer the app-host base (correct under
// the marketing/app host split), else the request's own origin (local dev).
function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// GET — browser-navigated (a plain link, not a fetch): sends the admin to
// Google's consent screen to connect a YouTube channel. Requires an
// authenticated admin session; the callback relies on the same session cookie
// still being present when Google redirects back.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const back = (path: string) => NextResponse.redirect(new URL(path, origin));

  if (!(await requireRoleAdmin())) return back("/login");
  // Plan gate. This is a browser navigation, not a fetch, so redirect back with
  // a flag rather than returning guardFeature's raw 402 JSON.
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  if (!(await checkFeature(tenantId, "ch_youtube")).ok) return back("/admin?tab=youtube&yt_error=not_in_plan");
  if (!youtubeConfigured()) return back("/admin?tab=youtube&yt_error=not_configured");

  const state = randomBytes(24).toString("hex");
  const redirectUri = `${origin}/api/admin/onboarding/youtube/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPE,
    access_type: "offline",
    prompt: "consent",     // force Google to reissue a refresh_token on every connect, not just the first ever
    state,
    include_granted_scopes: "true",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  // Short-lived, httpOnly CSRF guard — the callback compares this against
  // Google's returned `state`. Not `secure` on http (local dev) so the round
  // trip still works there.
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
