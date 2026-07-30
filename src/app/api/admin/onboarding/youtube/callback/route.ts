import { NextRequest, NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listChannels, saveYoutubeChannel } from "@/lib/channels";
import { enforceLimit } from "@/lib/usage";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// GET — Google redirects the browser here after the consent screen (?code=…
// &state=…, or ?error=… if the admin cancelled). Exchanges the code for
// tokens, resolves the connected YouTube channel, and saves/updates it for
// this tenant. Always lands back on the YouTube tab with a result flag —
// never a raw error page, since this is a full page navigation the admin sees.
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  const back = (qs: string) => {
    const res = NextResponse.redirect(new URL(`/admin?tab=youtube&${qs}`, origin));
    res.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });   // one-time use, clear regardless of outcome
    return res;
  };

  if (!(await requireRoleAdmin())) return NextResponse.redirect(new URL("/login", origin));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (err) return back("yt_error=denied");
  if (!code || !state || !cookieState || state !== cookieState) return back("yt_error=state_mismatch");

  try {
    const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const redirectUri = `${origin}/api/admin/onboarding/youtube/callback`;
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, redirect_uri: redirectUri, grant_type: "authorization_code",
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET as string,
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => null)) as { access_token?: string; refresh_token?: string } | null;
    if (!tokenRes.ok || !tokenJson?.access_token) return back("yt_error=exchange_failed");
    // prompt=consent should always reissue one, but Google can occasionally omit
    // it — fail loudly rather than saving a channel that can never auto-refresh.
    if (!tokenJson.refresh_token) return back("yt_error=no_refresh_token");

    const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const chJson = (await chRes.json().catch(() => null)) as { items?: { id?: string; snippet?: { title?: string } }[] } | null;
    const channel = chJson?.items?.[0];
    if (!chRes.ok || !channel?.id) return back("yt_error=channel_lookup_failed");

    // Reconnecting an already-connected channel updates it in place (fresh
    // refresh token) instead of creating a duplicate row.
    const existing = (await listChannels(tenantId)).find(c => c.kind === "youtube" && c.ytChannelId === channel.id);
    if (!existing) {
      try { await enforceLimit(tenantId, "channels"); }
      catch { return back("yt_error=channel_limit"); }
    }
    await saveYoutubeChannel({
      id: existing?.id, tenantId,
      name: channel.snippet?.title || "YouTube channel",
      ytChannelId: channel.id,
      token: tokenJson.refresh_token,
      active: true,
    });
    logActivity(await currentUser(), "channel.save", `YouTube "${channel.snippet?.title ?? channel.id}" connected`);
    return back("yt=connected");
  } catch {
    return back("yt_error=save_failed");
  }
}
