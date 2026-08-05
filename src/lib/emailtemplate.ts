// Branded HTML email shell shared by every lifecycle email we send (weekly
// recap, onboarding nudge). Renders BOTH an HTML and a plain-text version from
// one set of inputs.
//
// Why hand-rolled tables instead of a normal stylesheet: email clients are not
// browsers. Outlook renders through Word's HTML engine, Gmail strips <link> and
// most positioning, and none of them support flexbox or grid reliably. The
// rules this file follows, all of which have a real client behind them:
//
//   • Layout is <table role="presentation"> with px widths, capped at 600px —
//     the widest that survives Outlook's default reading pane without a
//     horizontal scrollbar.
//   • Every style that MATTERS is inline on the element. The <style> block is
//     progressive enhancement only (dark mode, small-screen stacking); if a
//     client drops it, the email still renders correctly in light mode.
//   • The CTA is a table cell with a background colour wrapping a padded <a>,
//     not a styled <div> — Outlook ignores padding on <a> alone, which
//     silently collapses a button into a bare link.
//   • A preheader (<div> hidden by size + colour) controls the preview line
//     shown next to the subject in the inbox list. Without one, clients grab
//     the first visible text, which is usually the logo alt text.
//
// The plain-text part isn't optional politeness: HTML-only mail scores worse
// with spam filters, and List-Unsubscribe-aware providers expect a multipart
// message from bulk senders.

const WIDTH = 600;
const BRAND = "#0783fd";
const INK = "#0f172a";
const BODY_TEXT = "#475569";
const MUTED = "#94a3b8";
const PAGE_BG = "#f1f5f9";
const CARD_BG = "#ffffff";
const HAIRLINE = "#e2e8f0";
const PANEL_BG = "#f8fafc";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

// Shared with src/app/api/contact/route.ts, which had its own copy. Every value
// interpolated into an email goes through this — none of today's callers pass
// tenant-controlled text, but the first one that does shouldn't have to
// discover that the template trusted its input.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailStat {
  value: string;
  label: string;
  /** Week-on-week movement, e.g. "+4 vs last week". Rendered small under the label. */
  delta?: string;
}

export interface EmailCta {
  label: string;
  href: string;
}

export interface EmailOptions {
  /** Inbox preview line. Say something the subject doesn't — never repeat it. */
  preheader: string;
  heading: string;
  /** Lead paragraphs, plain text. Rendered in order above the stats/CTA. */
  paragraphs: string[];
  stats?: EmailStat[];
  /** One takeaway drawn from the numbers — the reason to keep reading. */
  highlight?: string;
  /** Numbered next steps. Rendered as a real ordered list in the text part. */
  steps?: string[];
  cta: EmailCta;
  /** Lower-commitment second action. Rendered as a plain link under the button. */
  secondary?: EmailCta;
  /** "You're getting this because…" — required; recipients ask, and it cuts spam reports. */
  footerReason: string;
  /** Omit for one-off transactional mail that has nothing to unsubscribe from. */
  unsubscribeHref?: string;
}

// Bulletproof CTA. The <a> is display:block inside a coloured, rounded cell so
// the whole button area is clickable in clients that honour padding on the
// anchor, and still a full-width coloured block in the ones that don't.
function button(cta: EmailCta, siteUrl: string): string {
  const href = absolute(cta.href, siteUrl);
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td class="btn" align="center" bgcolor="${BRAND}" style="background-color:${BRAND};border-radius:9999px;">
                    <a href="${escapeHtml(href)}" style="display:block;padding:15px 34px;font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:9999px;">${escapeHtml(cta.label)}</a>
                  </td>
                </tr>
              </table>`;
}

// Email clients need absolute URLs — a root-relative href resolves against the
// webmail's own origin and 404s.
function absolute(href: string, siteUrl: string): string {
  return /^(https?:|mailto:)/i.test(href) ? href : `${siteUrl}${href.startsWith("/") ? "" : "/"}${href}`;
}

function statCells(stats: EmailStat[]): string {
  const w = Math.floor(100 / stats.length);
  return stats.map(s => `
                  <td class="stat" width="${w}%" align="center" valign="top" style="padding:16px 8px;background-color:${PANEL_BG};border-radius:12px;">
                    <div style="font-family:${FONT};font-size:30px;line-height:34px;font-weight:800;color:${BRAND};">${escapeHtml(s.value)}</div>
                    <div class="t-body" style="font-family:${FONT};font-size:12px;line-height:16px;color:${BODY_TEXT};padding-top:4px;">${escapeHtml(s.label)}</div>
                    ${s.delta ? `<div class="t-muted" style="font-family:${FONT};font-size:11px;line-height:15px;color:${MUTED};padding-top:3px;">${escapeHtml(s.delta)}</div>` : ""}
                  </td>`).join(`
                  <td width="12" style="font-size:0;line-height:0;">&nbsp;</td>`);
}

// The horizontal lockup (540×138, ≈3.913:1) — the same asset the site header
// uses, NOT brand/talkopng.png, which is the 2:1 padded mark meant for
// schema.org and renders visibly squashed at wordmark proportions.
const LOGO_W = 133;
const LOGO_H = 34;

export function renderEmail(o: EmailOptions, siteUrl: string): { html: string; text: string } {
  const logo = `${siteUrl}/brand/talko-logo.png`;

  const html = `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(o.heading)}</title>
<style>
  /* Progressive enhancement only — the inline styles above already render a
     correct light-mode email if a client strips this block. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  a { color: ${BRAND}; }
  @media (prefers-color-scheme: dark) {
    .page-bg { background-color: #0b1220 !important; }
    .card { background-color: #141d30 !important; }
    .t-ink { color: #f1f5f9 !important; }
    .t-body { color: #cbd5e1 !important; }
    .t-muted { color: #8fa0b8 !important; }
    .stat, .panel { background-color: #1c2740 !important; }
    .hairline { border-color: #2a3752 !important; }
  }
  @media only screen and (max-width: 480px) {
    /* Stack the stat columns rather than squeezing three into a phone width. */
    .stat { display: block !important; width: 100% !important; margin-bottom: 8px !important; }
    .gap { display: none !important; }
    .pad { padding-left: 22px !important; padding-right: 22px !important; }
    .h1 { font-size: 24px !important; line-height: 30px !important; }
  }
</style>
</head>
<body class="page-bg" style="margin:0;padding:0;width:100%;background-color:${PAGE_BG};">
  <!-- Inbox preview line. Hidden in the body but read by the client's list view. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="page-bg" style="background-color:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" style="width:${WIDTH}px;max-width:${WIDTH}px;">

          <!-- Wordmark on a white chip. The lockup has dark navy lettering baked
               into the PNG, so on a dark-mode background it would all but vanish —
               the same reason the site footer sits it on white. Deliberately NOT
               overridden in the dark media query below.
               alt text carries the brand when images are blocked, which is the
               default in Outlook and for any unknown sender. -->
          <tr>
            <td align="left" style="padding:0 0 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:10px;padding:9px 14px;">
                    <a href="${escapeHtml(siteUrl)}" style="text-decoration:none;">
                      <img src="${escapeHtml(logo)}" width="${LOGO_W}" height="${LOGO_H}" alt="Talko AI" style="display:block;border:0;outline:none;width:${LOGO_W}px;height:${LOGO_H}px;font-family:${FONT};font-size:17px;font-weight:800;color:${BRAND};text-decoration:none;">
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="card" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};border-radius:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                <tr>
                  <td class="pad" style="padding:34px 36px 0;">
                    <h1 class="h1 t-ink" style="margin:0;font-family:${FONT};font-size:27px;line-height:33px;font-weight:800;color:${INK};">${escapeHtml(o.heading)}</h1>
                  </td>
                </tr>

                ${o.paragraphs.map(p => `<tr>
                  <td class="pad" style="padding:14px 36px 0;">
                    <p class="t-body" style="margin:0;font-family:${FONT};font-size:15px;line-height:23px;color:${BODY_TEXT};">${escapeHtml(p)}</p>
                  </td>
                </tr>`).join("\n                ")}

                ${o.stats?.length ? `<tr>
                  <td class="pad" style="padding:24px 36px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>${statCells(o.stats).replace(/<td width="12"/g, `<td class="gap" width="12"`)}
                      </tr>
                    </table>
                  </td>
                </tr>` : ""}

                ${/* Steps before the highlight: a lead-in paragraph ("pick whichever
                      channel…:") has to run straight into its own list, and it puts
                      the highlight where reassurance is most useful — immediately
                      above the button. */""}
                ${o.steps?.length ? `<tr>
                  <td class="pad" style="padding:20px 36px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      ${o.steps.map((s, i) => `<tr>
                        <td width="26" valign="top" style="padding:6px 0 0;font-family:${FONT};font-size:14px;line-height:21px;font-weight:800;color:${BRAND};">${i + 1}.</td>
                        <td class="t-body" valign="top" style="padding:6px 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${BODY_TEXT};">${escapeHtml(s)}</td>
                      </tr>`).join("\n                      ")}
                    </table>
                  </td>
                </tr>` : ""}

                ${o.highlight ? `<tr>
                  <td class="pad" style="padding:22px 36px 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="panel" bgcolor="${PANEL_BG}" style="background-color:${PANEL_BG};border-radius:12px;">
                      <tr>
                        <td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:21px;color:${INK};" class="t-ink">${escapeHtml(o.highlight)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>` : ""}

                <tr>
                  <td class="pad" align="center" style="padding:28px 36px 0;">
${button(o.cta, siteUrl)}
                  </td>
                </tr>

                ${o.secondary ? `<tr>
                  <td class="pad" align="center" style="padding:14px 36px 0;">
                    <a href="${escapeHtml(absolute(o.secondary.href, siteUrl))}" style="font-family:${FONT};font-size:13px;line-height:19px;font-weight:600;color:${BRAND};text-decoration:underline;">${escapeHtml(o.secondary.label)}</a>
                  </td>
                </tr>` : ""}

                <tr><td class="pad" style="padding:34px 36px 0;"><div class="hairline" style="border-top:1px solid ${HAIRLINE};font-size:0;line-height:0;">&nbsp;</div></td></tr>

                <tr>
                  <td class="pad" style="padding:16px 36px 30px;">
                    <p class="t-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(o.footerReason)}</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 24px 8px;">
              <p class="t-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
                Talko AI by PM Technologies<br>
                <a href="${escapeHtml(siteUrl)}/guides" style="color:${MUTED};text-decoration:underline;">Guides</a> &nbsp;·&nbsp;
                <a href="${escapeHtml(siteUrl)}/status" style="color:${MUTED};text-decoration:underline;">Status</a> &nbsp;·&nbsp;
                <a href="${escapeHtml(siteUrl)}/contact" style="color:${MUTED};text-decoration:underline;">Contact</a>${o.unsubscribeHref ? ` &nbsp;·&nbsp;
                <a href="${escapeHtml(o.unsubscribeHref)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>` : ""}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Built from the same inputs rather than by stripping the HTML — stripping
  // produces text littered with the layout's spacer cells and swallows the
  // button, which is the one thing the text part most needs to carry.
  const lines: string[] = [o.heading, ""];
  for (const p of o.paragraphs) lines.push(p, "");
  if (o.stats?.length) {
    for (const s of o.stats) lines.push(`  ${s.value} — ${s.label}${s.delta ? ` (${s.delta})` : ""}`);
    lines.push("");
  }
  if (o.steps?.length) {
    o.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push("");
  }
  if (o.highlight) lines.push(o.highlight, "");
  lines.push(`${o.cta.label}: ${absolute(o.cta.href, siteUrl)}`);
  if (o.secondary) lines.push(`${o.secondary.label}: ${absolute(o.secondary.href, siteUrl)}`);
  lines.push("", "—", o.footerReason, "Talko AI by PM Technologies");
  if (o.unsubscribeHref) lines.push(`Unsubscribe: ${o.unsubscribeHref}`);

  return { html, text: lines.join("\n") };
}
