import { describe, it, expect } from "vitest";
import { renderEmail, escapeHtml } from "../emailtemplate";

// These lock in the properties an email breaks WITHOUT anyone noticing: the
// plain-text part silently dropping the CTA link, the preheader leaking into
// the visible body, a root-relative href that 404s against the webmail's own
// origin, and interpolated text escaping into markup.

const SITE = "https://www.thetalko.in";

const BASE = {
  preheader: "Preview line that should never be visible in the body",
  heading: "Your week on Talko AI",
  paragraphs: ["Here's what ran on autopilot."],
  cta: { label: "Open your inbox", href: "/login" },
  footerReason: "You're getting this because you own a Talko AI workspace.",
};

describe("renderEmail — structure", () => {
  it("emits a complete HTML document email clients can parse", () => {
    const { html } = renderEmail(BASE, SITE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    // Table layout, not divs — Outlook has no flexbox/grid.
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:600px");
    // Dark-mode declaration, so clients don't invert it themselves badly.
    expect(html).toContain('name="color-scheme"');
  });

  it("hides the preheader from the rendered body while keeping it in the source", () => {
    const { html } = renderEmail(BASE, SITE);
    const i = html.indexOf(BASE.preheader);
    expect(i).toBeGreaterThan(-1);
    // The containing element must be display:none AND zero-height — several
    // clients ignore one but honour the other.
    const container = html.slice(Math.max(0, i - 220), i);
    expect(container).toContain("display:none");
    expect(container).toContain("max-height:0");
  });

  it("renders the CTA as a padded anchor inside a coloured table cell", () => {
    const { html } = renderEmail(BASE, SITE);
    // Outlook drops padding on a bare <a>; the cell must carry the background
    // so the button never collapses to a plain text link.
    expect(html).toMatch(/<td class="btn"[^>]*bgcolor="#0783fd"/);
    expect(html).toMatch(/<a href="https:\/\/www\.thetalko\.in\/login"[^>]*padding:15px 34px/);
  });
});

describe("renderEmail — links", () => {
  it("makes every relative href absolute", () => {
    const { html, text } = renderEmail({ ...BASE, secondary: { label: "Guides", href: "/guides" } }, SITE);
    expect(html).toContain("https://www.thetalko.in/login");
    expect(html).toContain("https://www.thetalko.in/guides");
    expect(text).toContain("https://www.thetalko.in/login");
    // A root-relative href would resolve against mail.google.com and 404.
    expect(html).not.toMatch(/href="\/(login|guides)"/);
  });

  it("leaves absolute and mailto links untouched", () => {
    const { html } = renderEmail({
      ...BASE,
      cta: { label: "Mail us", href: "mailto:info@thetalko.in" },
      unsubscribeHref: "https://example.com/u/abc",
    }, SITE);
    expect(html).toContain('href="mailto:info@thetalko.in"');
    expect(html).toContain("https://example.com/u/abc");
  });

  it("omits the unsubscribe link entirely when none is given", () => {
    const { html, text } = renderEmail(BASE, SITE);
    expect(html).not.toContain("Unsubscribe");
    expect(text).not.toContain("Unsubscribe");
  });
});

describe("renderEmail — plain-text part", () => {
  it("carries the CTA URL, since that is the one thing text readers need", () => {
    const { text } = renderEmail(BASE, SITE);
    expect(text).toContain("Open your inbox: https://www.thetalko.in/login");
  });

  it("contains no HTML tags or layout artefacts", () => {
    const { text } = renderEmail({
      ...BASE,
      stats: [{ value: "12", label: "new conversations", delta: "+3 vs the week before" }],
      highlight: "Worth a look.",
      steps: ["Connect a channel", "Add your AI key"],
      secondary: { label: "Guides", href: "/guides" },
      unsubscribeHref: "https://example.com/u/abc",
    }, SITE);
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(text).not.toContain("&nbsp;");
    // Built from the inputs, not stripped from the HTML — so the preheader
    // (an HTML-only device) must not appear.
    expect(text).not.toContain(BASE.preheader);
    expect(text).toContain("12 — new conversations (+3 vs the week before)");
    expect(text).toContain("1. Connect a channel");
  });
});

describe("renderEmail — escaping", () => {
  it("escapes interpolated values instead of letting them become markup", () => {
    const { html } = renderEmail({
      ...BASE,
      heading: `Acme <script>alert(1)</script> & Co`,
      paragraphs: [`Quote " and apostrophe '`],
    }, SITE);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; Co");
  });

  it("escapes ampersands before the entities it introduces", () => {
    // Naive ordering turns "<" into "&lt;" and then the "&" into "&amp;lt;".
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("renderEmail — stats", () => {
  it("lays out three stats as separate cells with spacers", () => {
    const { html } = renderEmail({
      ...BASE,
      stats: [
        { value: "12", label: "new conversations" },
        { value: "34", label: "AI replies sent" },
        { value: "5", label: "new leads" },
      ],
    }, SITE);
    expect(html.match(/class="stat"/g)?.length).toBe(3);
    expect(html).toContain('width="33%"');
    // Spacer cells must be the collapsible kind, or mobile stacking leaves gaps.
    expect(html).toContain('class="gap" width="12"');
  });

  it("renders a stat with no delta without an empty trailing element", () => {
    const { html } = renderEmail({ ...BASE, stats: [{ value: "0", label: "new leads" }] }, SITE);
    expect(html).toContain(">0<");
    expect(html).not.toContain("undefined");
  });
});
