import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, resolveFacebookPages, grantedScopes, noGrantMessage } from "@/lib/embeddedsignup";
import { saveMessengerChannel, subscribePageToApp, findMessengerChannelId } from "@/lib/channels";
import { enforceLimit } from "@/lib/usage";
import { guardFeature } from "@/lib/feature-guard";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tagged so one tenant attempt is enough to tell which step failed, from logs.
const TAG = "[fb-onboarding]";

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

  let body: { code?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });

  const ex = await exchangeSignupCode(body.code);
  if (!ex.ok || !ex.token) return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });
  const token = ex.token;

  // What Meta ACTUALLY granted this tenant — logged every time, because "works
  // for my account, not for tenants" is decided here and nowhere else.
  const scopes = await grantedScopes(token);
  console.log(TAG, "granted scopes", { tenantId, scopes: scopes ?? "(probe failed)" });

  const res = await resolveFacebookPages(token);
  if (!res.ok || !res.pages?.length) {
    // "No Page found" and "we were granted no Page permission" are the same
    // response from Graph and need opposite fixes — one is theirs, one is ours.
    const noGrant = noGrantMessage(scopes, "pages_", "Facebook Page");
    console.error(TAG, "page resolve failed", { tenantId, error: res.error, noGrant: !!noGrant });
    return NextResponse.json({ error: noGrant ?? res.error ?? "No Facebook Page found" }, { status: 502 });
  }

  // Choose the Page: the one the caller picked, or the only one — else ask the
  // admin to pick (they'll re-run the login for a fresh code with the pageId).
  const pageId = body.pageId?.trim();
  const chosen = pageId ? res.pages.find(p => p.id === pageId) : (res.pages.length === 1 ? res.pages[0] : null);
  if (!chosen) {
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
    logActivity(await currentUser(), "channel.save", `${saved.name} (Messenger ${saved.pageId}) via Facebook login — webhook ${webhook.ok ? "subscribed" : `FAILED: ${webhook.detail}`}`);
    return NextResponse.json({
      success: true,
      channel: { id: saved.id, name: saved.name, pageId: saved.pageId, token: mask(saved.token) },
      webhook,
    });
  } catch (e) {
    console.error(TAG, "channel save failed", { tenantId, pageId: chosen.id, error: e });
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
