import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireRoleAdmin } from "@/lib/auth";
import { googleReviewsConfigured, GOOGLE_REVIEWS_SCOPE } from "@/lib/googlereviews";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "gr_oauth_state";

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// GET — browser-navigated: sends the admin to Google's consent screen to
// connect a Google Business Profile. Mirrors the YouTube connect flow (same
// OAuth client, different scope) — see onboarding/youtube/start for the
// twin implementation notes.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const back = (path: string) => NextResponse.redirect(new URL(path, origin));

  if (!(await requireRoleAdmin())) return back("/login");
  if (!googleReviewsConfigured()) return back("/admin?tab=reviews&gr_error=not_configured");

  const state = randomBytes(24).toString("hex");
  const redirectUri = `${origin}/api/admin/onboarding/google-reviews/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_REVIEWS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
