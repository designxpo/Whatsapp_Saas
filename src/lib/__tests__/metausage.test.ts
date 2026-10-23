// Meta's own usage figures, read off the responses we already get.
//
// On 23 Oct the company deployment's Meta app reached 100% of its
// application-level rate limit and was blocked, after a week at 60–95% that
// nothing on screen showed. Meta reports the figure on every response that counts — the
// X-App-Usage header — so watching it costs no extra calls. This module keeps
// the latest reading, the health check alerts on it, and background Meta work
// pauses before the app is blocked rather than after.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ platform: {} as Record<string, unknown>, writes: 0 }));
vi.mock("../store", () => ({
  getSetting: async (k: string, fb: unknown) => (k in h.platform ? h.platform[k] : fb),
  setSetting: async (k: string, v: unknown) => { if (k === "meta_app_usage") h.writes++; h.platform[k] = v; },
}));
const sent = vi.hoisted(() => [] as { to: string; subject: string }[]);
vi.mock("../email", () => ({ sendEmail: async (m: { to: string; subject: string }) => { sent.push(m); return { ok: true }; } }));

const { parseUsage, observeMetaResponse, metaAppUsage, metaBackgroundAllowed, drainMetaUsageAlert, PAUSE_AT, _resetMetaUsage } = await import("../metausage");

const res = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
const NOW = Date.parse("2026-10-23T08:00:00Z");

beforeEach(() => { h.platform = {}; h.writes = 0; sent.length = 0; _resetMetaUsage(); process.env.ADMIN_USER = "owner@x.co"; delete process.env.PLATFORM_ALERT_EMAILS; });

describe("parseUsage", () => {
  it("reads the app-level figure as the highest of its three measures", () => {
    expect(parseUsage(new Headers({ "x-app-usage": '{"call_count":86,"total_cputime":0,"total_time":25}' }))).toBe(86);
    expect(parseUsage(new Headers({ "x-app-usage": '{"call_count":10,"total_cputime":3,"total_time":40}' }))).toBe(40);
  });
  it("is null when the response did not count toward the app limit, or the header is malformed", () => {
    expect(parseUsage(new Headers({ "x-business-use-case-usage": '{"1":[{"call_count":3}]}' }))).toBeNull();
    expect(parseUsage(new Headers({ "x-app-usage": "not json" }))).toBeNull();
    expect(parseUsage(new Headers())).toBeNull();
  });
});

describe("observeMetaResponse", () => {
  it("records a reading from a Meta response", async () => {
    observeMetaResponse("https://graph.facebook.com/v22.0/me/accounts", res({ "x-app-usage": '{"call_count":72}' }), NOW);
    expect((await metaAppUsage(NOW))?.pct).toBe(72);
  });

  it("ignores every host that is not Meta's", async () => {
    observeMetaResponse("https://example.supabase.co/rest/v1/x", res({ "x-app-usage": '{"call_count":99}' }), NOW);
    expect(await metaAppUsage(NOW)).toBeNull();
  });

  it("persists at most once a minute, but at once when it crosses the pause line", async () => {
    observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": '{"call_count":40}' }), NOW);
    observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": '{"call_count":41}' }), NOW + 5_000);
    await Promise.resolve();
    expect(h.writes).toBe(1);
    observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": `{"call_count":${PAUSE_AT}}` }), NOW + 10_000);
    await Promise.resolve();
    expect(h.writes).toBe(2);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => observeMetaResponse("not a url", res({}), NOW)).not.toThrow();
    expect(() => observeMetaResponse("https://graph.facebook.com/a", { headers: null } as unknown as Response, NOW)).not.toThrow();
  });
});

describe("metaBackgroundAllowed", () => {
  it("allows background Meta work below the pause line and stops it at it", async () => {
    observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": '{"call_count":60}' }), NOW);
    expect(await metaBackgroundAllowed(NOW)).toBe(true);
    observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": `{"call_count":${PAUSE_AT}}` }), NOW);
    expect(await metaBackgroundAllowed(NOW)).toBe(false);
  });

  it("reads another instance's reading from the platform setting", async () => {
    h.platform.meta_app_usage = { pct: 95, at: new Date(NOW - 60_000).toISOString() };
    expect(await metaBackgroundAllowed(NOW)).toBe(false);
  });

  it("treats an hour-old reading as unknown — the limit is a rolling hour, so it has drained", async () => {
    h.platform.meta_app_usage = { pct: 99, at: new Date(NOW - 61 * 60_000).toISOString() };
    expect(await metaBackgroundAllowed(NOW)).toBe(true);
    expect(await metaAppUsage(NOW)).toBeNull();
  });
});

describe("installMetaObserver", () => {
  it("passes every response through untouched and records Meta's figure", async () => {
    const realFetch = globalThis.fetch;
    const body = { ok: true };
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { headers: { "x-app-usage": '{"call_count":33}' } })) as typeof fetch;
    try {
      const { installMetaObserver } = await import("../metausage");
      installMetaObserver();
      installMetaObserver();   // idempotent: a second start-up must not wrap twice
      const r = await fetch("https://graph.facebook.com/v22.0/x");
      expect(await r.json()).toEqual(body);
      expect((await metaAppUsage())?.pct).toBe(33);
    } finally { globalThis.fetch = realFetch; }
  });
});

describe("drainMetaUsageAlert", () => {
  const at = (pct: number) => observeMetaResponse("https://graph.facebook.com/a", res({ "x-app-usage": `{"call_count":${pct}}` }), NOW);

  it("emails the platform owner at the pause line", async () => {
    at(PAUSE_AT + 2);
    expect(await drainMetaUsageAlert(NOW)).toMatchObject({ alerted: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("owner@x.co");
    expect(sent[0].subject).toContain(`${PAUSE_AT + 2}%`);
  });

  it("stays quiet below it", async () => {
    at(PAUSE_AT - 1);
    expect((await drainMetaUsageAlert(NOW)).alerted).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends at most once every 6 hours", async () => {
    at(95);
    await drainMetaUsageAlert(NOW);
    await drainMetaUsageAlert(NOW + 60 * 60_000);
    expect(sent).toHaveLength(1);
  });

  it("is off with PLATFORM_ALERT_EMAILS=off, like the other platform alerts", async () => {
    process.env.PLATFORM_ALERT_EMAILS = "off";
    at(95);
    expect((await drainMetaUsageAlert(NOW)).alerted).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
