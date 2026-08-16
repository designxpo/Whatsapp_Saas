import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { igLoginReady, igLoginMissing, igRedirectUri, igAuthorizeUrl, signState, IG_SCOPES } from "@/lib/iglogin";

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

  if (!igLoginReady()) {
    return fail(`Instagram connect isn't switched on for this deployment yet — missing ${igLoginMissing().join(" + ")}. Use “Add manually” meanwhile.`);
  }

  const redirectUri = igRedirectUri(req.url);
  const url = igAuthorizeUrl(redirectUri, signState(tenantId, Date.now()));
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

// Three states, not two. "Saved, but Meta refused message delivery" was
// rendering under a green "Instagram connected" heading — so a channel that can
// never receive a DM looked exactly like one that works, and the warning read as
// a footnote to good news. A half-connection has to look like a half-connection.
export function popupHtml(result: { ok: boolean; warn?: boolean; error?: string; detail?: string }): string {
  const json = JSON.stringify({ source: "talko-ig-login", ...result });
  const safe = (s: string) => s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
  const heading = !result.ok ? "Couldn’t connect Instagram"
    : result.warn ? "Connected — but not receiving yet"
    : "Instagram connected";
  const body = result.ok ? (result.detail ?? "You can close this window.") : (result.error ?? "Something went wrong.");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe(heading)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;
       font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F6F7F5;color:#14171A}
  @media (prefers-color-scheme:dark){body{background:#0F1211;color:#E9EDE9}.card{background:#171B19!important;border-color:#282E2B!important}}
  .card{max-width:440px;background:#fff;border:1px solid #E2E5E1;border-radius:12px;padding:24px 26px}
  h1{font-size:17px;margin:0 0 8px;font-weight:700}
  p{margin:0;color:#5B6167;font-size:14px}
  .bad h1{color:#A32A22}
  .warn h1{color:#8A5B0C}
</style>
<div class="card ${!result.ok ? "bad" : result.warn ? "warn" : ""}"><h1>${safe(heading)}</h1><p>${safe(body)}</p></div>
<script>
  try { window.opener && window.opener.postMessage(${json}, window.location.origin); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, ${result.ok && !result.warn ? 900 : 12000});
</script>`;
}
