// The small page the Instagram connect popup shows before it closes: it posts
// the outcome to the portal tab that opened it. Lives outside the route files
// because Next.js allows only its own exports (GET, dynamic…) from a route.

// Three states, not two. "Saved, but Meta refused message delivery" was
// rendering under a green "Instagram connected" heading — so a channel that can
// never receive a DM looked exactly like one that works, and the warning read as
// a footnote to good news. A half-connection has to look like a half-connection.
export function popupHtml(result: { ok: boolean; warn?: boolean; error?: string; detail?: string }): string {
  // Inlined into a <script>, where JSON escaping is not enough: an error text
  // containing </script> (Instagram's error_description comes off the query
  // string, so anyone can write it into a link) would end the block and run
  // whatever follows as the signed-in admin. Escaped so no text can close it.
  const json = JSON.stringify({ source: "talko-ig-login", ...result })
    .replace(/[<>&\u2028\u2029]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
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
