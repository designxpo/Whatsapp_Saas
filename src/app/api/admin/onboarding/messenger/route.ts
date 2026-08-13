import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeForLongLivedToken, resolveFacebookPages } from "@/lib/embeddedsignup";
import { saveMessengerChannel, subscribePageToApp } from "@/lib/channels";
import { enforceLimit } from "@/lib/usage";
import { guardFeature } from "@/lib/feature-guard";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mask = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "••••");

// POST — finish "Connect with Facebook" for the Messenger (Page) channel.
// Body: { userToken, pageId?, name? } — userToken is the short-lived USER token
// from plain FB.login (granted pages_show_list + pages_messaging +
// pages_manage_engagement + pages_read_engagement + pages_read_user_content). We
// exchange it for a long-lived token, list the Pages the admin manages, and — once
// a Page is chosen (auto when there's exactly one) — save a Messenger channel with
// that Page's OWN long-lived token and subscribe the Page to our app webhook.
//
// A Page CHOICE re-runs FB.login for a fresh token (no re-consent), so Page access
// tokens never touch the client.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  { const gate = await guardFeature(tenantId, "ch_messenger"); if (gate) return gate; }

  let body: { userToken?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.userToken) return NextResponse.json({ error: "Missing user token" }, { status: 400 });

  // Long-lived so the derived Page tokens don't expire; fall back to the short
  // token (best-effort) if the exchange can't run (e.g. app secret unset).
  const ll = await exchangeForLongLivedToken(body.userToken);
  const token = ll.ok && ll.token ? ll.token : body.userToken;

  const res = await resolveFacebookPages(token);
  if (!res.ok || !res.pages?.length) return NextResponse.json({ error: res.error || "No Facebook Page found" }, { status: 502 });

  // Choose the Page: the one the caller picked, or the only one — else ask the
  // admin to pick (they'll re-run the login for a fresh code with the pageId).
  const pageId = body.pageId?.trim();
  const chosen = pageId ? res.pages.find(p => p.id === pageId) : (res.pages.length === 1 ? res.pages[0] : null);
  if (!chosen) {
    return NextResponse.json({ needsPageChoice: true, pages: res.pages.map(p => ({ id: p.id, name: p.name })) });
  }

  try { await enforceLimit(tenantId, "channels"); }
  catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }

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
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
