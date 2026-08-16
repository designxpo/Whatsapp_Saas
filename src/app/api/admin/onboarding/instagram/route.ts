import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, resolveInstagramAsset, grantedScopes } from "@/lib/embeddedsignup";
import { saveInstagramChannel, resolveIgAccountId, subscribeIgToApp } from "@/lib/channels";
import { guardFeature } from "@/lib/feature-guard";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every failure below is logged with this tag as well as returned. The tenant
// sees the message in the portal; this is what lets us tell WHICH step failed
// from the server logs when they only report "it didn't connect".
const TAG = "[ig-onboarding]";

// POST — finish Instagram Embedded Signup for the current tenant.
// Body: { code, igUserId, pageId, name } from the FB.login Embedded Signup
// (Instagram login with instagram_manage_messages). Exchanges the code for a
// token and saves an Instagram channel (token encrypted at rest).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  // Parity with the manual "Add manually" route, which has always enforced both.
  // Skipping them here meant Embedded Signup could add an Instagram channel to a
  // plan that doesn't include one, and past the channel cap.
  { const gate = await guardFeature(tenantId, "ch_instagram"); if (gate) return gate; }

  let body: { code?: string; igUserId?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { code } = body;
  if (!code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });

  try { await enforceLimit(tenantId, "channels"); }
  catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }

  const ex = await exchangeSignupCode(code);
  if (!ex.ok || !ex.token) {
    console.error(TAG, "token exchange failed", { tenantId, error: ex.error });
    return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });
  }

  // What Meta granted this tenant, logged on every attempt — the one line that
  // separates a tenant-side setup problem from an app-side permission problem.
  const scopes = await grantedScopes(ex.token);
  console.log(TAG, "granted scopes", { tenantId, scopes: scopes ?? "(probe failed)" });

  // Resolve the account with the Instagram API this app is actually APPROVED for.
  //
  // There are two Instagram APIs and they use different permission families and
  // different hosts:
  //   Instagram Login   instagram_business_* → graph.instagram.com/me
  //   Facebook Login    instagram_basic      → graph.facebook.com Page{instagram_business_account}
  // This app holds instagram_business_basic + instagram_business_manage_messages
  // and does NOT hold instagram_basic — and lib/instagram.ts already sends on
  // graph.instagram.com for exactly that reason. But onboarding only ever tried
  // the Page route, so Graph returned the Page with the Instagram field omitted
  // (it omits fields a token can't see rather than erroring), which reads as
  // "this Page has no Instagram account linked" — a dead end no tenant could
  // clear, because their Page was never the problem.
  //
  // So try the approved API first, and keep the Page route as the fallback for a
  // deployment still on Facebook Login.
  let igUserId = body.igUserId?.trim();
  let pageId = body.pageId?.trim() || null;
  let username: string | undefined;

  if (!igUserId) {
    const direct = await resolveIgAccountId(ex.token);
    if (direct.id) {
      igUserId = direct.id;
      username = direct.username;
      console.log(TAG, "resolved via Instagram Login", { tenantId, igUserId, username });
    } else {
      const asset = await resolveInstagramAsset(ex.token);
      if (!asset.ok || !asset.igUserId) {
        console.error(TAG, "asset resolve failed on both APIs", { tenantId, instagramLogin: direct.error, facebookLogin: asset.error });
        return NextResponse.json({ error: asset.error || direct.error || "Could not resolve Instagram account" }, { status: 502 });
      }
      igUserId = asset.igUserId;
      pageId = asset.pageId ?? null;
      console.log(TAG, "resolved via Facebook Page", { tenantId, igUserId, pageId });
    }
  }

  // Whatever route found the id, the token still has to be one the messaging API
  // accepts — storing a channel that can neither send nor receive is the worst
  // outcome available, so prove it before saving. (Free when we came from the
  // Instagram Login branch, which is the same call.)
  const live = username ? { id: igUserId, username } : await resolveIgAccountId(ex.token);
  if (!live.id) {
    console.error(TAG, "token rejected by the Instagram messaging API", { tenantId, igUserId, error: live.error });
    return NextResponse.json({
      error: `Meta connected the account, but the token it gave us isn't accepted by the Instagram messaging API (${live.error || "no account returned"}). Nothing was saved — a channel stored now could never send or receive. Use “Add manually” with an Instagram access token, and send this message to support.`,
    }, { status: 502 });
  }
  // Trust Graph's own answer over the Page-derived id: inbound webhooks match on
  // this id EXACTLY, so a mismatch silently drops every DM while sends still work.
  if (live.id !== igUserId) {
    console.warn(TAG, "account id corrected", { tenantId, from: igUserId, to: live.id });
    igUserId = live.id;
  }
  username = live.username ?? username;

  try {
    const channel = await saveInstagramChannel({
      tenantId,
      name: body.name?.trim() || (username ? `@${username}` : `Instagram ${igUserId}`),
      igUserId,
      pageId,
      token: ex.token,
      isDefault: false,
    });
    // The manual route has always done this; without it Meta delivers no DM or
    // comment events for a freshly added account, so the channel would look
    // connected and stay silent.
    const webhook = await subscribeIgToApp(channel.igUserId ?? igUserId, ex.token);
    console.log(TAG, "connected", { tenantId, channelId: channel.id, igUserId: channel.igUserId, pageId: channel.pageId, webhook: webhook.ok || webhook.detail });
    return NextResponse.json({
      success: true,
      webhook,
      channel: { id: channel.id, name: channel.name, igUserId: channel.igUserId, pageId: channel.pageId },
    });
  } catch (e) {
    console.error(TAG, "channel save failed", { tenantId, igUserId, error: e });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save channel" }, { status: 500 });
  }
}
