// Turning five inconsistent URL parameters into one answer.
//
// The thing this must never do is call an untagged lead organic. "Organic"
// means the channel works for free; "untagged" means the measurement is
// broken, and they lead to opposite budget decisions. One of them is also the
// number everybody would like to be bigger, which is exactly why it is never
// inferred.
import { describe, it, expect } from "vitest";
import { deriveOrigin, utmAttributes, hasAttribution } from "../attribution";

describe("the platform, under one name however it was typed", () => {
  it("collapses the spellings of Google", () => {
    for (const s of ["google", "Google", "googleads", "google-ads", "adwords", "youtube", "YT"]) {
      expect(deriveOrigin({ source: s, medium: "cpc" }).platform, s).toBe("Google");
    }
  });

  it("collapses the spellings of Meta", () => {
    for (const s of ["fb", "facebook", "FB", "Meta", "ig", "instagram"]) {
      expect(deriveOrigin({ source: s, medium: "paid_social" }).platform, s).toBe("Meta");
    }
  });

  it("strips the protocol and www a referrer-style source arrives with", () => {
    expect(deriveOrigin({ source: "https://www.facebook.com", medium: "referral" }).platform).toBe("Meta");
  });

  it("keeps a platform it does not know, rather than discarding it", () => {
    // A source we have no rule for is still better than nothing.
    expect(deriveOrigin({ source: "coursera", medium: "referral" }).platform).toBe("Coursera");
  });
});

describe("paid or organic — stated, never guessed", () => {
  it("reads paid out of the medium", () => {
    for (const m of ["cpc", "ppc", "paid", "paid_social", "paid-social", "display", "cpm", "remarketing"]) {
      expect(deriveOrigin({ source: "google", medium: m }).kind, m).toBe("paid");
    }
  });

  it("reads organic out of the medium", () => {
    for (const m of ["organic", "social", "referral", "email", "none", "seo"]) {
      expect(deriveOrigin({ source: "google", medium: m }).kind, m).toBe("organic");
    }
  });

  it("does NOT call Google paid just because it is Google", () => {
    // An organic search and a search ad are the same platform and a very
    // different cost. Without a medium we say so.
    expect(deriveOrigin({ source: "google" }).kind).toBe("unknown");
    expect(deriveOrigin({ source: "google" }).label).toBe("Google");
  });

  it("treats a click id as proof of paid, because only an ad appends one", () => {
    expect(deriveOrigin({ gclid: "Cj0KCQ" }).label).toBe("Google (paid)");
    expect(deriveOrigin({ fbclid: "IwAR1" }).label).toBe("Meta (paid)");
  });

  it("lets a click id name the platform when the source is missing", () => {
    expect(deriveOrigin({ medium: "cpc", gclid: "Cj0KCQ" }).platform).toBe("Google");
  });
});

describe("what it refuses to invent", () => {
  it("answers Unknown for a lead with nothing", () => {
    const o = deriveOrigin({});
    expect(o.label).toBe("Unknown");
    expect(o.kind).toBe("unknown");
  });

  it("never reports an untagged lead as organic", () => {
    // The whole point. Untagged is a measurement failure, not a free channel.
    for (const u of [{}, { campaign: "spring" }, { source: "" }, { medium: "  " }]) {
      expect(deriveOrigin(u).kind, JSON.stringify(u)).not.toBe("organic");
    }
  });
});

describe("what gets stamped on the contact", () => {
  it("keeps every value that arrived", () => {
    expect(utmAttributes({
      source: "google", medium: "cpc", campaign: "da-delhi",
      term: "data analytics course", content: "ad-b",
    })).toMatchObject({
      utm_source: "google", utm_medium: "cpc", utm_campaign: "da-delhi",
      utm_term: "data analytics course", utm_content: "ad-b",
      lead_origin: "Google (paid)",
    });
  });

  it("leaves an empty value OUT rather than writing it blank", () => {
    // A blank reads as "we looked and found nothing", which is a different
    // claim from "we never knew".
    const a = utmAttributes({ source: "google", medium: "", campaign: null });
    expect("utm_medium" in a).toBe(false);
    expect("utm_campaign" in a).toBe(false);
  });

  it("writes nothing at all when nothing was known", () => {
    expect(utmAttributes({})).toEqual({});
  });

  it("omits lead_origin rather than stamping Unknown", () => {
    const a = utmAttributes({ campaign: "spring" });
    expect(a.utm_campaign).toBe("spring");
    expect("lead_origin" in a).toBe(false);
  });

  it("bounds a hostile value — these arrive on a public URL", () => {
    expect(utmAttributes({ source: "x".repeat(900) }).utm_source).toHaveLength(256);
  });
});

describe("hasAttribution decides whether a visitor is worth a row", () => {
  it("is true for any single signal", () => {
    for (const u of [{ source: "google" }, { campaign: "x" }, { gclid: "g" }, { fbclid: "f" }, { content: "c" }]) {
      expect(hasAttribution(u), JSON.stringify(u)).toBe(true);
    }
  });

  it("is false for nothing", () => {
    expect(hasAttribution({})).toBe(false);
    expect(hasAttribution({ source: null, gclid: null })).toBe(false);
  });
});
