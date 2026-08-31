// renderCampaign builds what every tenant actually receives, and a
// personalisation bug here doesn't hit one recipient — it hits the whole list
// simultaneously, unrecallably. Pure function, so it's cheap to pin down.

import { describe, it, expect } from "vitest";
import { renderCampaign, type OwnerCampaign } from "../ownerbroadcast";

function campaign(over: Partial<OwnerCampaign> = {}): OwnerCampaign {
  return {
    id: "c1", subject: "Hello", mode: "simple",
    heading: "Heading", bodyParagraphs: ["Body copy."], imageUrl: null,
    ctaLabel: null, ctaUrl: null, htmlBody: null,
    audienceMode: "all", status: "draft",
    totalRecipients: 0, sentCount: 0, failedCount: 0, errorSummary: null,
    createdBy: null, createdAt: new Date().toISOString(), sentAt: null,
    ...over,
  };
}

const priya = { company: "Bolt Taekwondo", ownerName: "Priya" };

describe("renderCampaign — personalisation", () => {
  it("substitutes {{company}} and {{name}} in the subject, heading and body independently", () => {
    const out = renderCampaign(
      campaign({
        subject: "{{company}}, your August recap",
        heading: "What shipped for {{company}}",
        bodyParagraphs: ["Hi {{name}}, here's what changed."],
      }),
      priya,
    );
    expect(out.subject).toBe("Bolt Taekwondo, your August recap");
    // The subject is a header, not part of the body — so the HTML only carries
    // company because the HEADING asked for it.
    expect(out.html).toContain("What shipped for Bolt Taekwondo");
    expect(out.html).toContain("Hi Priya");
  });

  it("is case- and whitespace-insensitive about the token", () => {
    const out = renderCampaign(campaign({ subject: "{{ COMPANY }} + {{Name}}" }), priya);
    expect(out.subject).toBe("Bolt Taekwondo + Priya");
  });

  it("falls back to neutral wording rather than an empty gap when the tenant has no company or name", () => {
    const out = renderCampaign(
      campaign({ subject: "{{company}} update", bodyParagraphs: ["Hi {{name}},"] }),
      { company: null, ownerName: null },
    );
    expect(out.subject).toBe("your business update");
    expect(out.html).toContain("Hi there,");
  });

  it("leaves an unknown token alone instead of blanking the text", () => {
    // A typo should be visible in a test send, not silently delete copy.
    const out = renderCampaign(campaign({ subject: "Hi {{frist_name}}" }), priya);
    expect(out.subject).toBe("Hi {{frist_name}}");
  });

  it("renders a plain-text alternative alongside the HTML", () => {
    const out = renderCampaign(campaign({ bodyParagraphs: ["First para.", "Second para."] }), priya);
    expect(out.text).toContain("First para.");
    expect(out.text).toContain("Second para.");
  });

  it("includes an uploaded image in simple mode", () => {
    const out = renderCampaign(campaign({ imageUrl: "https://cdn.example.com/a.png" }), priya);
    expect(out.html).toContain("https://cdn.example.com/a.png");
    expect(out.text).toContain("https://cdn.example.com/a.png");   // text part names it rather than dropping it
  });

  it("renders a CTA button only when both label and URL are present", () => {
    const withCta = renderCampaign(campaign({ ctaLabel: "See what's new", ctaUrl: "https://x.test/changelog" }), priya);
    expect(withCta.html).toContain("See what&#39;s new");
    const labelOnly = renderCampaign(campaign({ ctaLabel: "See what's new", ctaUrl: null }), priya);
    expect(labelOnly.html).not.toContain("See what&#39;s new");
  });
});

describe("renderCampaign — custom HTML mode", () => {
  it("sends the HTML verbatim, still personalised", () => {
    const out = renderCampaign(
      campaign({ mode: "html", htmlBody: `<div class="x"><h1>Hi {{name}}</h1></div>` }),
      priya,
    );
    expect(out.html).toBe(`<div class="x"><h1>Hi Priya</h1></div>`);
  });

  it("derives a readable text alternative by stripping markup and styles", () => {
    const out = renderCampaign(
      campaign({ mode: "html", htmlBody: `<style>h1{color:red}</style><h1>Big news</h1><p>Details here.</p>` }),
      priya,
    );
    expect(out.text).toBe("Big news Details here.");
    expect(out.text).not.toContain("color:red");   // the <style> block must not leak into the text part
  });
});
