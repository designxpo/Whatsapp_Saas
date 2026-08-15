import { describe, it, expect } from "vitest";
import { isRetriableDelivery } from "../integrations";

// Which failed integration deliveries are safe to replay. The stakes are
// asymmetric: not retrying loses a lead forever, but retrying a Slack/Teams post
// that actually landed double-posts it. So the rule is "retry only what provably
// didn't arrive" — network errors and the 5xx/429 family — and never a 4xx,
// which is the endpoint refusing the request outright.
describe("isRetriableDelivery", () => {
  it("retries a network error (no HTTP status at all)", () => {
    expect(isRetriableDelivery("webhook", new Error("fetch failed"))).toBe(true);
    expect(isRetriableDelivery("slack", new Error("The operation was aborted"))).toBe(true);
  });

  it("retries the transient HTTP family", () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetriableDelivery("webhook", new Error(`HTTP ${s}`))).toBe(true);
    }
  });

  it("does NOT retry a 4xx — the endpoint refused it, so nothing was posted", () => {
    for (const s of [400, 404, 410, 422]) {
      expect(isRetriableDelivery("webhook", new Error(`HTTP ${s}`))).toBe(false);
    }
  });

  it("does not retry auth failures for chat destinations (a revoked Slack hook stays dead)", () => {
    expect(isRetriableDelivery("slack", new Error("HTTP 401"))).toBe(false);
    expect(isRetriableDelivery("teams", new Error("HTTP 403"))).toBe(false);
  });

  it("DOES retry auth failures for CRMs — the token is re-pastable and deliver() is idempotent", () => {
    expect(isRetriableDelivery("hubspot", new Error("HTTP 401"))).toBe(true);
    expect(isRetriableDelivery("pipedrive", new Error("HTTP 403"))).toBe(true);
  });

  it("never retries a configuration problem — replaying it would fail identically forever", () => {
    expect(isRetriableDelivery("webhook", new Error("No URL configured"))).toBe(false);
    expect(isRetriableDelivery("webhook", new Error("Invalid URL"))).toBe(false);
    expect(isRetriableDelivery("webhook", new Error("Only http(s) URLs are allowed"))).toBe(false);
    expect(isRetriableDelivery("webhook", new Error("Host is not allowed"))).toBe(false);
    expect(isRetriableDelivery("webhook", new Error("Refusing to call a private or reserved address"))).toBe(false);
    expect(isRetriableDelivery("webhook", new Error("Too many redirects"))).toBe(false);
  });
});
