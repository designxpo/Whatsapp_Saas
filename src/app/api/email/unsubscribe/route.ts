// Public unsubscribe endpoint for recurring lifecycle email.
//
// Two entry points, deliberately behaving differently:
//
//   POST — performs the opt-out. This is what Gmail/Yahoo's one-click
//          unsubscribe button calls (List-Unsubscribe-Post: List-Unsubscribe=
//          One-Click), so it must work with no session, no CSRF token and no
//          confirmation step.
//   GET  — shows a confirm page whose button POSTs here. GET must NOT
//          unsubscribe: mail clients and security scanners prefetch links in
//          email, and a GET that mutated state would silently opt people out
//          who never clicked anything.
//
// No auth: the signed token in the URL IS the authorisation, and it only ever
// grants "turn off this one email stream for this one workspace".

import { NextResponse } from "next/server";
import { verifyUnsubscribeToken, setUnsubscribed } from "@/lib/emailprefs";
import { SITE_URL } from "@/lib/siteurl";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = { weekly_recap: "the weekly recap email" };

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Talko AI</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:#f1f5f9; color:#475569;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
  .card { width:100%; max-width:440px; background:#fff; border-radius:16px; padding:32px;
    box-shadow:0 2px 12px -6px rgba(0,0,0,.08); text-align:center; }
  h1 { margin:0 0 10px; font-size:20px; line-height:27px; font-weight:800; color:#0f172a; }
  p { margin:0 0 18px; font-size:14px; line-height:22px; }
  button { appearance:none; border:0; cursor:pointer; width:100%; padding:13px 24px; border-radius:9999px;
    background:#0783fd; color:#fff; font-size:14px; font-weight:700; font-family:inherit; }
  button:hover { background:#2a96ff; }
  a.link { display:inline-block; margin-top:14px; font-size:13px; font-weight:600; color:#0783fd; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b1220; color:#cbd5e1; }
    .card { background:#141d30; box-shadow:none; }
    h1 { color:#f1f5f9; }
  }
</style>
</head><body><div class="card">${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const claim = verifyUnsubscribeToken(token);
  if (!claim) {
    return page("Link expired", `
      <h1>This unsubscribe link isn't valid</h1>
      <p>It may have been truncated by your email client, or it belongs to an older sending setup. Email
      <a href="mailto:info@thetalko.in?subject=Unsubscribe">info@thetalko.in</a> and we'll take care of it.</p>
      <a class="link" href="${SITE_URL}">Go to Talko AI &rarr;</a>`, 400);
  }
  const what = LABELS[claim.kind] ?? "these emails";
  // The token is echoed into a hidden field so the POST needs no query string —
  // some clients strip query params when following a form action.
  return page("Unsubscribe", `
      <h1>Unsubscribe from ${what}?</h1>
      <p>You'll stop receiving ${what}. Emails about your account — security, billing and anything you
      explicitly ask for — will still reach you.</p>
      <form method="post" action="/api/email/unsubscribe">
        <input type="hidden" name="t" value="${token.replace(/"/g, "&quot;")}">
        <button type="submit">Yes, unsubscribe me</button>
      </form>
      <a class="link" href="${SITE_URL}">No thanks, keep them coming &rarr;</a>`);
}

export async function POST(req: Request) {
  // Token can arrive in the form body (our confirm page) or the query string
  // (a provider's one-click button, which POSTs to the header URL as-is).
  let token = new URL(req.url).searchParams.get("t") ?? "";
  if (!token) {
    try {
      const form = await req.formData();
      token = String(form.get("t") ?? "");
    } catch {
      /* one-click POSTs may send an empty or non-form body; the query param covers those */
    }
  }

  const claim = verifyUnsubscribeToken(token);
  if (!claim) return page("Link expired", `<h1>This unsubscribe link isn't valid</h1>
      <p>Email <a href="mailto:info@thetalko.in?subject=Unsubscribe">info@thetalko.in</a> and we'll remove you by hand.</p>`, 400);

  try {
    await setUnsubscribed(claim.tenantId, claim.kind, true);
  } catch (e) {
    console.error("[unsubscribe] failed to persist", claim.tenantId, e);
    return page("Something went wrong", `<h1>We couldn't save that just now</h1>
      <p>Please try again, or email <a href="mailto:info@thetalko.in?subject=Unsubscribe">info@thetalko.in</a> and we'll do it manually.</p>`, 500);
  }

  const what = LABELS[claim.kind] ?? "these emails";
  return page("Unsubscribed", `
      <h1>Done — you're unsubscribed</h1>
      <p>You won't get ${what} again. Account, security and billing emails still apply. You can turn the
      recap back on any time from your workspace settings.</p>
      <a class="link" href="${SITE_URL}/login">Open Talko AI &rarr;</a>`);
}
