import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { igLoginReady, igLoginMissing, igRedirectUri, igAuthorizeUrl, signState, IG_SCOPES } from "@/lib/iglogin";
import { popupHtml } from "@/lib/igpopup";
import { metaCredsForTenant } from "@/lib/partner-meta";

export const dynamic = "force-dynamic";

// GET — open Business Login for Instagram in a popup.
//
// Unlike WhatsApp and Messenger this is NOT an FB.login() call: Instagram Login
// is a plain redirect flow, so the button opens this route in a popup and Meta
// sends the tenant back to /callback. Building the URL server-side keeps the app
// id and the scope list out of the client bundle, and means the state can be
// signed with a server secret.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return fail("Admins only — ask your workspace owner to connect Instagram.");
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  const gate = await guardFeature(tenantId, "ch_instagram");
  if (gate) {
    const body = await gate.json().catch(() => ({ error: "Instagram isn't included in your plan." }));
    return fail(body.error ?? "Instagram isn't included in your plan.");
  }

  // White-label: a partner workspace connects through the partner's own
  // Instagram app when the partner has one switched on; everyone else through
  // Talko's, exactly as before.
  const partnerApp = await metaCredsForTenant(tenantId);
  const igApp = partnerApp?.igAppId && partnerApp.igAppSecret ? { appId: partnerApp.igAppId, appSecret: partnerApp.igAppSecret } : undefined;
  if (!igApp && !igLoginReady()) {
    return fail(`Instagram connect isn't switched on for this deployment yet — missing ${igLoginMissing().join(" + ")}. Use “Add manually” meanwhile.`);
  }

  const redirectUri = igRedirectUri(req.url, igApp);
  const url = igAuthorizeUrl(redirectUri, signState(tenantId, Date.now()), igApp);
  console.log("[ig-login] start", { tenantId, redirectUri, scopes: IG_SCOPES });
  return NextResponse.redirect(url, 302);
}

// The popup has no React around it, so an error has to render as its own page —
// and hand the message back to the opener, which is where the tenant is looking.
function fail(message: string): Response {
  return new Response(popupHtml({ ok: false, error: message }), {
    status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
