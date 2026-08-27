import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, exchangeForLongLivedToken, resolveFacebookPages, grantedScopes, noGrantMessage, FB_COMMENT_SCOPE, fbScopesKey } from "@/lib/embeddedsignup";
import { saveMessengerChannel, subscribePageToApp, findMessengerChannelId } from "@/lib/channels";
import { enforceLimit } from "@/lib/usage";
import { guardFeature } from "@/lib/feature-guard";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";
import { getTenantSecret, setTenantSecret, setTenantSetting } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tagged so one tenant attempt is enough to tell which step failed, from logs.
const TAG = "[fb-onboarding]";

// A Login-for-Business code is SINGLE USE. Picking a Page used to re-run
// FB.login for a second code, and the SDK hands back a cached authResponse
// carrying the code that was already spent — which Meta rejects with "Error
// validating verification code. Please make sure your redirect_uri is identical
// to the one you used in the OAuth dialog request", a message that sends you
// hunting a redirect_uri problem that does not exist.
//
// So the token from the FIRST exchange is parked here for the length of the
// choice, and the pick spends no code at all. Encrypted at rest like any other
// Meta token, and short-lived because it is a live credential for the tenant's
// Pages.
const PENDING = "fb_pending_login";
const PENDING_TTL_MS = 10 * 60_000;

async function parkToken(tenantId: string, token: string) {
  await setTenantSecret(tenantId, PENDING, JSON.stringify({ token, at: Date.now() }));
}
async function takeParkedToken(tenantId: string): Promise<string | null> {
  const raw = await getTenantSecret(tenantId, PENDING).catch(() => null);
  if (!raw) return null;
  try {
    const { token, at } = JSON.parse(raw) as { token?: string; at?: number };
    if (!token || !at || Date.now() - at > PENDING_TTL_MS) return null;
    return token;
  } catch { return null; }
}

const mask = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "••••");

// POST — finish "Connect with Facebook" for the Messenger (Page) channel, via
// Facebook Login for Business (config_id-based, same mechanism as WhatsApp/
// Instagram). Body: { code, pageId?, name? } — code is the single-use
// authorization code from FB.login. We exchange it for a business token, list
// the Pages the admin manages, and — once a Page is chosen (auto when there's
// exactly one) — save a Messenger channel with that Page's OWN token and
// subscribe the Page to our app webhook.
//
// A Page CHOICE re-runs FB.login for a fresh code (no re-consent), so Page
// access tokens never touch the client.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  // A plan without ch_messenger refuses here, before any Meta round-trip. Logged
  // because the tenant only sees "not in your plan" and support needs to know
  // which workspace and plan produced it.
  { const gate = await guardFeature(tenantId, "ch_messenger"); if (gate) { console.error(TAG, "blocked by plan (ch_messenger)", { tenantId }); return gate; } }

  let body: { code?: string; token?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // The popup hands back a short-lived USER token now, not an authorization
  // code — the code flow cannot work against a "General" login configuration
  // (launchFacebookSignup carries the full reason). `code` is still honoured so
  // a browser running a cached older bundle keeps working through a deploy.
  const fresh = body.token?.trim() || null;

  // Second leg of a Page choice: no new login, reuse the parked token.
  const parked = body.pageId && !fresh && !body.code ? await takeParkedToken(tenantId) : null;
  if (body.pageId && !fresh && !body.code && !parked) {
    return NextResponse.json({ error: "That Page choice expired. Click Connect with Facebook again." }, { status: 400 });
  }
  if (!fresh && !body.code && !parked) return NextResponse.json({ error: "Missing Facebook login" }, { status: 400 });

  const ex = parked ? { ok: true as const, token: parked, error: undefined }
           : fresh  ? { ok: true as const, token: fresh, error: undefined }
                    : await exchangeSignupCode(body.code!);
  if (!ex.ok || !ex.token) {
    console.error(TAG, "token exchange failed", { tenantId, error: ex.error });
    // Meta's own code/subcode/trace goes to the tenant too. Without it this
    // failure is a sentence with three possible causes and no way to tell which,
    // which is exactly how the last one cost a day chasing a redirect_uri that
    // this flow does not even use.
    return NextResponse.json({ error: ex.error || "Token exchange failed", diagnostic: ex.diagnostic }, { status: 502 });
  }
  // A Page token inherits the lifetime of the USER token it was derived from, so
  // this has to happen BEFORE /me/accounts — afterwards is too late, the Page
  // tokens are already minted. exchangeForLongLivedToken was written for exactly
  // this ("which is what a stored Messenger channel needs", per its own comment)
  // and then never wired in, so every Page connected through the popup was stored
  // with a token that expires. Best-effort: a no-op for a system-user token, and
  // a failure here must never block a connect that would otherwise work.
  const long = await exchangeForLongLivedToken(ex.token).catch(() => ({ ok: false } as const));
  const token = ("token" in long && long.ok && long.token) ? long.token : ex.token;
  if (!("token" in long && long.ok)) console.warn(TAG, "long-lived upgrade skipped", { tenantId });

  // What Meta ACTUALLY granted this tenant — logged every time, because "works
  // for my account, not for tenants" is decided here and nowhere else.
  const scopes = await grantedScopes(token);
  console.log(TAG, "granted scopes", { tenantId, scopes: scopes ?? "(probe failed)" });

  const res = await resolveFacebookPages(token);
  if (!res.ok || !res.pages?.length) {
    // THREE different causes produce one empty /me/accounts, and they need
    // opposite fixes — so name which one it is instead of asserting the tenant
    // has no Page (they usually do, and being told otherwise is a dead end):
    //   • no pages_* permission at all      → our Meta app's review/config
    //   • pages_show_list missing           → same, narrower
    //   • permissions fine, no Page attached → they clicked past "Choose the
    //     Pages you want Talko.AI to access" without ticking one, and Facebook
    //     will not re-ask while the grant stands
    const noGrant = noGrantMessage(scopes, "pages_", "Facebook Page");
    const canList = scopes?.includes("pages_show_list");
    console.error(TAG, "page resolve failed", {
      tenantId, error: res.error, noGrant: !!noGrant, canList,
      scopes: scopes ?? "(probe failed)",
    });
    const error = noGrant
      ?? (scopes && !canList
        ? "Facebook granted the connection but not permission to list your Pages, so we can't see which Page to set up. Remove Talko.AI under Facebook → Settings → Business integrations, then connect again and leave every permission enabled."
        : scopes
          ? "Facebook granted the permissions but attached no Page to them. On Meta's \"Choose the Pages you want Talko.AI to access\" step, tick the Page and continue — Facebook won't ask again while the current approval stands, so first remove Talko.AI under Facebook → Settings → Business integrations."
          : res.error ?? "No Facebook Page found");
    return NextResponse.json({ error, diagnostic: { scopes: scopes ?? undefined } }, { status: 502 });
  }

  // Choose the Page: the one the caller picked, or the only one — else ask the
  // admin to pick (they'll re-run the login for a fresh code with the pageId).
  const pageId = body.pageId?.trim();
  const chosen = pageId ? res.pages.find(p => p.id === pageId) : (res.pages.length === 1 ? res.pages[0] : null);
  if (!chosen) {
    // Park the token so the pick costs no second login (see PENDING above).
    await parkToken(tenantId, token).catch(e => console.error(TAG, "could not park token", { tenantId, e }));
    return NextResponse.json({ needsPageChoice: true, pages: res.pages.map(p => ({ id: p.id, name: p.name })) });
  }

  // Reconnecting an already-connected Page adds no channel, so it must not be
  // refused by the plan's channel cap — and a tenant who retried a few times
  // used to burn their whole allowance on duplicates of the same Page.
  const reconnecting = !!(await findMessengerChannelId(tenantId, chosen.id).catch(() => undefined));
  if (!reconnecting) {
    try { await enforceLimit(tenantId, "channels"); }
    catch (e) {
      // Logged because this refusal arrives AFTER the tenant has been through
      // Meta's popup and picked a Page — it reads as "it just didn't work".
      console.error(TAG, "channel cap reached", { tenantId, pageId: chosen.id, error: errorMessage(e) });
      return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 });
    }
  }

  try {
    const saved = await saveMessengerChannel({
      tenantId, name: body.name?.trim() || chosen.name, pageId: chosen.id, token: chosen.token,
    });
    // Subscribe the Page to the app — without this Meta delivers no message/feed
    // events (the exact reason a portal-added Page "didn't work").
    const webhook = await subscribePageToApp(saved.pageId ?? chosen.id, chosen.token);
    await setTenantSecret(tenantId, PENDING, "").catch(() => {});   // spent — do not leave a live token parked

    // Remember what Meta granted, and let a missing comment permission be said
    // out loud instead of discovered when a comment rule never fires. Same trap
    // as Instagram: a Page can carry the `feed` subscription without the
    // permission that makes Meta deliver it, so the subscription proves nothing
    // and only the grant list settles it.
    if (scopes?.length) {
      await setTenantSetting(tenantId, fbScopesKey(saved.id), scopes).catch(e => console.error(TAG, "could not store granted scopes", e));
    }
    // Null scopes mean the probe failed — unknown, never "not granted".
    const commentsGranted = scopes?.length ? scopes.includes(FB_COMMENT_SCOPE) : null;
    const reported = (webhook.ok && !webhook.degraded && commentsGranted === false)
      ? { ...webhook, degraded: true, detail: `${saved.name} is connected and Messenger DMs will arrive — but comment access wasn't granted, so comment-to-DM and comment-reply rules can never fire on this Page. Connect it again and leave every permission switched on.` }
      : webhook;

    logActivity(await currentUser(), "channel.save", `${saved.name} (Messenger ${saved.pageId}) via Facebook login — webhook ${webhook.ok ? "subscribed" : `FAILED: ${webhook.detail}`}${commentsGranted === false ? " — no comment permission granted" : ""}`);
    return NextResponse.json({
      success: true,
      channel: { id: saved.id, name: saved.name, pageId: saved.pageId, token: mask(saved.token) },
      webhook: reported,
    });
  } catch (e) {
    console.error(TAG, "channel save failed", { tenantId, pageId: chosen.id, error: e });
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
