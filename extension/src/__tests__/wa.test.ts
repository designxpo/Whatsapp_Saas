import { describe, it, expect } from "vitest";
import { normalizePhone, parseSelection, waClickToChatUrl, qrImageUrl, sourceLabel } from "../wa.js";

// The extension's pure helpers. These run on text a human highlighted on an
// arbitrary web page, so the parsing has to be forgiving about formatting but
// strict about what it claims to have found — a wrong number means messaging a
// stranger, and a wrong source label corrupts the portal's capture records.

describe("normalizePhone", () => {
  it("strips human formatting down to digits", () => {
    expect(normalizePhone("+91 98765-43210").digits).toBe("919876543210");
    expect(normalizePhone("(044) 2822 1234").digits).toBe("04428221234");
  });

  it("keeps the leading + in e164 but never in digits", () => {
    expect(normalizePhone("+919876543210")).toEqual({ digits: "919876543210", e164: "+919876543210" });
    expect(normalizePhone("919876543210").e164).toBe("919876543210");
  });

  it("handles empty and nullish input", () => {
    expect(normalizePhone("").digits).toBe("");
    expect(normalizePhone(undefined).digits).toBe("");
  });
});

describe("parseSelection", () => {
  it("pulls name, phone and email out of a pasted signature block", () => {
    const p = parseSelection("Priya Sharma\npriya@acme.co.in\n+91 98765 43210");
    expect(p.name).toBe("Priya Sharma");
    expect(p.email).toBe("priya@acme.co.in");
    expect(p.phone).toBe("919876543210");
  });

  it("handles a one-line, comma-separated selection", () => {
    const p = parseSelection("Rahul Verma, +91 90000 11111, rahul@shop.in");
    expect(p.name).toBe("Rahul Verma");
    expect(p.phone).toBe("919000011111");
    expect(p.email).toBe("rahul@shop.in");
  });

  it("returns empty fields rather than guessing when nothing matches", () => {
    expect(parseSelection("click here to learn more")).toMatchObject({ phone: "", email: "" });
    expect(parseSelection("")).toEqual({ name: "", phone: "", email: "" });
  });

  it("does not mistake the phone number for the name", () => {
    const p = parseSelection("+91 98765 43210");
    expect(p.phone).toBe("919876543210");
    expect(p.name).toBe("");
  });

  it("finds an email even with no name or phone present", () => {
    expect(parseSelection("contact: sales@example.com").email).toBe("sales@example.com");
  });

  it("collapses messy whitespace from a page selection", () => {
    expect(parseSelection("  Asha   Nair \n\n  +91 99999 88888 ").name).toBe("Asha Nair");
  });

  it("caps an over-long name so a whole paragraph can't become one", () => {
    const p = parseSelection(`${"a".repeat(200)} +91 98765 43210`);
    expect(p.name.length).toBeLessThanOrEqual(60);
  });
});

describe("waClickToChatUrl", () => {
  it("builds a wa.me link without the + and with no query when there's no text", () => {
    expect(waClickToChatUrl("+91 98765 43210")).toBe("https://wa.me/919876543210");
  });

  it("url-encodes the prefilled message", () => {
    expect(waClickToChatUrl("919876543210", "Hi Priya, thanks!"))
      .toBe("https://wa.me/919876543210?text=Hi%20Priya%2C%20thanks!");
  });
});

describe("qrImageUrl", () => {
  it("encodes the payload and defaults to a printable size", () => {
    const url = qrImageUrl("https://wa.me/919876543210");
    expect(url).toContain("size=240x240");
    expect(url).toContain(encodeURIComponent("https://wa.me/919876543210"));
  });

  it("clamps absurd sizes instead of asking the service for them", () => {
    expect(qrImageUrl("x", 5)).toContain("size=80x80");
    expect(qrImageUrl("x", 99999)).toContain("size=1000x1000");
  });
});

describe("sourceLabel", () => {
  it("recognises the platforms leads actually come from", () => {
    expect(sourceLabel("in.linkedin.com")).toBe("linkedin");
    expect(sourceLabel("www.instagram.com")).toBe("instagram");
    expect(sourceLabel("m.facebook.com")).toBe("facebook");
    expect(sourceLabel("www.youtube.com")).toBe("youtube");
    expect(sourceLabel("youtu.be")).toBe("youtube");
  });

  it("maps both twitter and x.com to one label", () => {
    expect(sourceLabel("twitter.com")).toBe("twitter");
    expect(sourceLabel("x.com")).toBe("twitter");
  });

  it("separates Google Maps from plain Google", () => {
    expect(sourceLabel("maps.google.com")).toBe("google-maps");
    expect(sourceLabel("business.google.com")).toBe("google");
  });

  // Regression: a loose substring test matched "x" inside any hostname, so every
  // lead captured from dropbox.com / xero.com was tagged source:twitter.
  it("does not tag unrelated sites containing a platform's letters", () => {
    expect(sourceLabel("dropbox.com")).toBe("dropbox");
    expect(sourceLabel("xero.com")).toBe("xero");
    expect(sourceLabel("shop.example.com")).toBe("example");
  });

  it("reduces a plain business domain to its core name", () => {
    expect(sourceLabel("www.acmefurniture.in")).toBe("acmefurniture");
    expect(sourceLabel("shop.acme.co.uk")).toBe("acme");
  });

  it("survives odd input", () => {
    expect(sourceLabel("localhost")).toBe("localhost");
    expect(sourceLabel("")).toBe("");
  });
});
