import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";
import { saveInstagramChannel, resolveIgAccountId, subscribeIgToApp, findInstagramChannelId } from "@/lib/channels";
import { igRedirectUri, verifyState, exchangeIgCode, igLongLivedToken } from "@/lib/iglogin";
import { popupHtml } from "../start/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TAG = "[ig-login]";
const html = (r: { ok: boolean; error?: string; detail?: string }) =>
  new Response(popupHtml(r), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

// GET — where Instagram sends the tenant back after Business Login.
//
// Everything here runs inside the popup, so nothing may throw to a JSON error
// page the tenant will never read: every exit renders a small page that posts
// the outcome to the opener and closes.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return html({ ok: false, error: "Your session expired. Sign in again and retry." });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  if (await guardFeature(tenantId, "ch_instagram")) return html({ ok: false, error: "Instagram isn't included in your plan." });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  // The tenant declined, or Instagram refused the request outright — a scope the
  // app isn't approved for lands here, so pass Meta's own words through.
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (denied) {
    console.error(TAG, "authorize declined", { tenantId, denied });
    return html({ ok: false, error: `Instagram didn't complete the connection: ${denied}` });
  }
  if (!code) return html({ ok: false, error: "Instagram sent us back without an authorization code. Please try again." });

  // Bound to this workspace and short-lived, so a callback URL captured or
  // replayed elsewhere cannot attach someone else's Instagram account here.
  const st = verifyState(state, tenantId, Date.now());
  if (!st.ok) {
    console.error(TAG, "state rejected", { tenantId, reason: st.reason });
    return html({ ok: false, error: `That connect link is no longer valid (${st.reason}). Start again from the Instagram page.` });
  }

  const short = await exchangeIgCode(code, igRedirectUri(req.url));
  if (!short.ok || !short.token) {
    console.error(TAG, "code exchange failed", { tenantId, error: short.error });
    return html({ ok: false, error: short.error || "Instagram wouldn't exchange the login code." });
  }
  console.log(TAG, "granted scopes", { tenantId, scopes: short.permissions ?? "(not reported)" });

  // The short-lived token dies within the hour. Storing it would hand every
  // tenant a channel that stops working the same afternoon, so the long-lived
  // exchange is required, not an optimisation.
  const long = await igLongLivedToken(short.token);
  if (!long.ok || !long.token) {
    console.error(TAG, "long-lived exchange failed", { tenantId, error: long.error });
    return html({ ok: false, error: `Instagram gave us a token that expires within the hour and wouldn't upgrade it (${long.error}). Nothing was saved.` });
  }
  const token = long.token;

  // Graph's own id, never a derived one: inbound webhooks match entry.id exactly,
  // so a wrong id silently drops every DM while sends keep working.
  const live = await resolveIgAccountId(token);
  if (!live.id) {
    console.error(TAG, "account resolve failed", { tenantId, error: live.error });
    return html({ ok: false, error: `Connected, but Instagram wouldn't tell us which account it was (${live.error}). Nothing was saved.` });
  }

  // Reconnecting the same account adds no channel — only a genuinely new one
  // counts against the plan's cap.
  if (!(await findInstagramChannelId(tenantId, live.id).catch(() => undefined))) {
    try { await enforceLimit(tenantId, "channels"); }
    catch (e) { console.error(TAG, "channel cap reached", { tenantId, igUserId: live.id }); return html({ ok: false, error: errorMessage(e) }); }
  }

  try {
    const channel = await saveInstagramChannel({
      tenantId,
      name: live.username ? `@${live.username}` : `Instagram ${live.id}`,
      igUserId: live.id,
      pageId: null,          // Instagram Login has no Page in the loop, and the runtime doesn't need one
      token,
      isDefault: false,
    });
    // Without this Meta delivers no DM or comment events at all — the channel
    // would look connected and stay permanently silent.
    const webhook = await subscribeIgToApp(channel.igUserId ?? live.id, token);
    console.log(TAG, "connected", { tenantId, channelId: channel.id, igUserId: channel.igUserId, webhook: webhook.ok ? (webhook.degraded ? "degraded" : "full") : webhook.detail });

    if (!webhook.ok) return html({ ok: true, detail: `Saved @${live.username ?? live.id}, but Meta wouldn't turn on message delivery: ${webhook.detail}` });
    return html({ ok: true, detail: webhook.degraded ? webhook.detail : `@${live.username ?? live.id} is connected and receiving.` });
  } catch (e) {
    console.error(TAG, "channel save failed", { tenantId, igUserId: live.id, error: e });
    return html({ ok: false, error: errorMessage(e) });
  }
}
