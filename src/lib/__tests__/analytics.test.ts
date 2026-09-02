// planFromHref is the only pure part of the analytics layer, and it is the
// part that silently loses money when wrong: it decides whether a trial CTA
// click is attributed to a plan at all. It runs against every anchor the user
// clicks anywhere on the marketing site, so it has to be unbothered by hrefs
// that aren't signup links and by the malformed ones a real DOM contains.

import { describe, it, expect } from "vitest";
import { planFromHref } from "../analytics";

describe("planFromHref", () => {
  it("reads the plan from every pricing CTA shape in _content/site.ts", () => {
    expect(planFromHref("/signup?plan=Starter")).toBe("Starter");
    expect(planFromHref("/signup?plan=Growth")).toBe("Growth");
    // Space-bearing plan names arrive percent-encoded from encodeURIComponent
    // (the /waitlist redirect) and raw from the hand-written hrefs. Both must
    // resolve to the same value, or one tier's clicks split across two labels.
    expect(planFromHref("/signup?plan=Creator%20Pro")).toBe("Creator Pro");
    expect(planFromHref("/signup?plan=Creator Pro")).toBe("Creator Pro");
  });

  it("returns null for a signup link with no plan, rather than a false one", () => {
    // The nav and hero both link to a bare /signup. Reporting those as a plan
    // choice would inflate select_plan and make the pricing page look worse
    // than it is.
    expect(planFromHref("/signup")).toBeNull();
    expect(planFromHref("/signup?plan=")).toBeNull();
    expect(planFromHref("/signup?plan=%20")).toBeNull();
    expect(planFromHref("/signup?ref=ABC123")).toBeNull();
  });

  it("ignores links that are not signup links at all", () => {
    expect(planFromHref("/pricing")).toBeNull();
    expect(planFromHref("/affiliate")).toBeNull();
    // A path merely CONTAINING "signup" is not the signup route.
    expect(planFromHref("/blog/signup-tips?plan=Growth")).toBeNull();
    expect(planFromHref("/affiliate/signup?plan=Growth")).toBeNull();
  });

  it("handles absolute URLs, since /signup lives on the app host", () => {
    expect(planFromHref("https://app.thetalko.in/signup?plan=Scale")).toBe("Scale");
    expect(planFromHref("https://www.thetalko.in/signup?plan=Scale")).toBe("Scale");
    // Trailing slash — same route, same plan.
    expect(planFromHref("/signup/?plan=Scale")).toBe("Scale");
  });

  it("never throws on the junk a real anchor's href can be", () => {
    // getAttribute("href") returns null for <a> without one; hash and mailto
    // links are all over the footer.
    expect(planFromHref(null)).toBeNull();
    expect(planFromHref(undefined)).toBeNull();
    expect(planFromHref("")).toBeNull();
    expect(planFromHref("#")).toBeNull();
    expect(planFromHref("mailto:hello@thetalko.in")).toBeNull();
    expect(planFromHref("javascript:void(0)")).toBeNull();
  });
});
