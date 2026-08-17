import { NextRequest, NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { saveGoogleReviewsChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "gr_oauth_state";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// GET — Google redirects here after consent. Unlike YouTube (one API call
// resolves "the" channel), a Google login can manage MANY Business Profile
// locations, so this only exchanges the code and stores the refresh token on a
// provisional, inactive channel — then hands off to the location picker (the
// ReviewsTab reads ?gr=pick&channelId=… and fetches accounts/locations for it).
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  const back = (qs: string) => {
    const res = NextResponse.redirect(new URL(`/admin?tab=reviews&${qs}`, origin));
    res.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  };

  if (!(await requireRoleAdmin())) return NextResponse.redirect(new URL("/login", origin));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (err) return back("gr_error=denied");
  // A missing/mismatched state most often means the connect link sat open past
  // its cookie's life, or was opened in a different browser/session than the
  // one that started it — say that, not the unhelpful "something went wrong".
  if (!code || !state || !cookieState || state !== cookieState) return back("gr_error=state_mismatch");

  try {
    const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const redirectUri = `${origin}/api/admin/onboarding/google-reviews/callback`;
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, redirect_uri: redirectUri, grant_type: "authorization_code",
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => null)) as { access_token?: string; refresh_token?: string; error?: string } | null;
    if (!tokenRes.ok || !tokenJson?.access_token) {
      // Same distinction as the YouTube callback: invalid_grant is a spent or
      // stale code (tenant retries cleanly); anything else is our deployment's
      // OAuth client being misconfigured, which no tenant action can fix.
      console.error("[google-reviews-oauth] token exchange failed", { tenantId, error: tokenJson?.error, status: tokenRes.status });
      return back(tokenJson?.error === "invalid_grant" ? "gr_error=code_expired" : "gr_error=exchange_failed");
    }
    if (!tokenJson.refresh_token) return back("gr_error=no_refresh_token");

    const channel = await saveGoogleReviewsChannel({
      tenantId, name: "Google Business Profile (pick a location)",
      token: tokenJson.refresh_token, active: false,
    });
    return back(`gr=pick&channelId=${encodeURIComponent(channel.id)}`);
  } catch (e) {
    console.error("[google-reviews-oauth] connect failed after Google succeeded", e);
    return back("gr_error=save_failed");
  }
}
