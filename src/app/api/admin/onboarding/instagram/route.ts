import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, resolveInstagramAsset } from "@/lib/embeddedsignup";
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

  // Embedded Signup returns only a code; resolve the IG account + Page from the
  // token server-side unless the caller (manual/admin form) supplied them.
  let igUserId = body.igUserId?.trim();
  let pageId = body.pageId?.trim() || null;
  if (!igUserId) {
    const asset = await resolveInstagramAsset(ex.token);
    if (!asset.ok || !asset.igUserId) {
      console.error(TAG, "asset resolve failed", { tenantId, error: asset.error });
      return NextResponse.json({ error: asset.error || "Could not resolve Instagram account" }, { status: 502 });
    }
    igUserId = asset.igUserId;
    pageId = asset.pageId ?? null;
  }

  // Prove the token works against the API we actually SEND with before storing
  // it. Embedded Signup runs on Facebook Login (graph.facebook.com), while this
  // product's Instagram runtime is Instagram Login (graph.instagram.com) — see
  // lib/instagram.ts. The two token families are not interchangeable, so a token
  // that resolved a Page fine can still be unusable for DMs. Saving it anyway
  // produces the worst outcome available: a channel that reads as connected and
  // can neither send nor receive. Fail here instead, and name the reason.
  const live = await resolveIgAccountId(ex.token);
  if (!live.id) {
    console.error(TAG, "token rejected by the Instagram API", { tenantId, igUserId, error: live.error });
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

  try {
    const channel = await saveInstagramChannel({
      tenantId,
      name: body.name?.trim() || (live.username ? `@${live.username}` : `Instagram ${igUserId}`),
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
