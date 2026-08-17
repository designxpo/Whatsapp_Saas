import { describe, it, expect } from "vitest";
import { describeAdsGraphError, accountStatusLabel } from "../ads";

// A tenant used to see Meta's raw sentence verbatim — "(#200) Ad account owner
// has NOT grant ads_management or ads_read permission" — which reads like
// something is wrong with THEIR account when the real fix is a Business
// Manager role grant, and gives no next step at all for the other codes Meta
// actually returns (expired token, dev-mode access limits, rate limiting).

describe("describeAdsGraphError", () => {
  it("translates a missing ad-account role (#200) into the Business Manager fix", () => {
    const msg = describeAdsGraphError({ code: 200, message: "(#200) Ad account owner has NOT grant ads_management or ads_read permission" }, 400);
    expect(msg).toMatch(/Business Manager/i);
    expect(msg).toMatch(/People/i);
    expect(msg).not.toMatch(/\(#200\)/);   // Meta's raw code must not leak through as the whole answer
  });

  it("matches the NOT-grant wording even without a numeric code (Meta doesn't always send one)", () => {
    const msg = describeAdsGraphError({ message: "Ad account owner has NOT grant ads_read" }, 400);
    expect(msg).toMatch(/Business Manager/i);
  });

  it("translates an expired/revoked token (#190) into a reconnect instruction", () => {
    const msg = describeAdsGraphError({ code: 190, message: "Error validating access token" }, 401);
    expect(msg).toMatch(/expired or.*revoked/i);
    expect(msg).toMatch(/reconnect/i);
  });

  it("distinguishes an unrecognised ad account id from a dev-mode access limit, both code 100", () => {
    const notFound = describeAdsGraphError({ code: 100, message: "Unsupported get request. Object does not exist" }, 400);
    expect(notFound).toMatch(/doesn't recognise this ad account id/i);

    const devMode = describeAdsGraphError({ code: 100, message: "Invalid parameter" }, 400);
    expect(devMode).toMatch(/Standard Access/i);
    expect(devMode).toMatch(/Advanced Access|app tester/i);
  });

  it("translates rate limiting (code 17, 613, or HTTP 429) into a wait-and-retry message", () => {
    for (const err of [{ code: 17 }, { code: 613 }]) {
      expect(describeAdsGraphError(err, 400)).toMatch(/rate.?limit/i);
    }
    expect(describeAdsGraphError(undefined, 429)).toMatch(/rate.?limit/i);
  });

  it("falls back to a plain HTTP failure notice with no error body at all", () => {
    expect(describeAdsGraphError(undefined, 500)).toMatch(/HTTP 500/);
  });

  it("labels an unrecognised error as Meta's own wording, not silently discarded", () => {
    const msg = describeAdsGraphError({ code: 999, message: "some new Meta error we've never seen" }, 400);
    expect(msg).toContain("some new Meta error we've never seen");
    expect(msg).toMatch(/not yet translated/i);   // must not pretend this is a considered answer
  });
});

describe("accountStatusLabel", () => {
  it("labels a disabled account with the reason category and where to fix it", () => {
    expect(accountStatusLabel(2)).toMatch(/Disabled/i);
    expect(accountStatusLabel(2)).toMatch(/Ads Manager/i);
  });

  it("labels an unsettled-balance account distinctly from a disabled one", () => {
    expect(accountStatusLabel(3)).toMatch(/[Uu]npaid|[Uu]nsettled/i);
    expect(accountStatusLabel(3)).not.toBe(accountStatusLabel(2));
  });

  it("labels the grace-period status as a payment problem, not a policy one", () => {
    expect(accountStatusLabel(9)).toMatch(/payment/i);
  });

  it("never returns a bare number for an unrecognised status code", () => {
    const label = accountStatusLabel(42);
    expect(label).toContain("42");            // the code is still there for support to look up
    expect(label).toMatch(/Ads Manager|unrecognised/i);   // but with real guidance attached
  });
});
