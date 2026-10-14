// What the limiter does when it cannot count.
//
// The shared counter lives in the database, so a Supabase outage — or an
// unapplied 0119 — used to mean no limit at all on login attempts, widget
// messages or a leaked API key. That is the moment an unlimited surface is
// worth the most to somebody.
//
// The replacement is not a real limiter and is not pretending to be one: it is
// per-lambda-instance, several instances each admit their own allowance, and a
// cold start forgets everything. It exists so that one instance cannot be an
// open firehose. The tests that matter are therefore less about the counting
// and more about the honesty: every degraded verdict says so, and the health
// board can still tell a fallback from a working limiter.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let rpc: () => Promise<{ data: unknown; error: unknown }> = async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null });

vi.mock("../supabase", () => ({
  db: () => ({ rpc: () => rpc() }),
}));

const DOWN = async () => ({ data: null, error: { message: "could not connect to server" } });

beforeEach(async () => {
  rpc = async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The fallback keeps state in module scope, which is the point of it — so
  // each test needs its own module instance.
  vi.resetModules();
});

// vi.spyOn returns the SAME spy when the method is already spied, and its
// call list survives the test that made it — without this, a later test
// counting log lines counts every earlier test's as well.
afterEach(() => { vi.restoreAllMocks(); });

// Unique bucket per test, belt and braces against shared module state.
let n = 0;
const bucket = () => `t${++n}:${Math.random().toString(36).slice(2)}`;

describe("while the shared counter works", () => {
  it("uses it, and never marks the verdict degraded", async () => {
    const { rateLimit } = await import("../ratelimit");
    const v = await rateLimit(bucket(), { limit: 5, windowSec: 60 });
    expect(v).toMatchObject({ allowed: true, retryAfterSec: 0 });
    expect(v.degraded).toBeFalsy();
  });

  it("passes through a refusal with its retry-after", async () => {
    rpc = async () => ({ data: [{ allowed: false, retry_after: 42 }], error: null });
    const { rateLimit } = await import("../ratelimit");
    const v = await rateLimit(bucket(), { limit: 5, windowSec: 60 });
    expect(v).toMatchObject({ allowed: false, retryAfterSec: 42 });
    expect(v.degraded).toBeFalsy();
  });
});

describe("when the shared counter is unavailable", () => {
  it("still limits, per instance, instead of allowing everything", async () => {
    // The old behaviour returned allowed:true forever. Three requests against
    // a limit of two must not all pass.
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const b = bucket();
    const verdicts = [];
    for (let i = 0; i < 4; i++) verdicts.push(await rateLimit(b, { limit: 2, windowSec: 60 }));
    expect(verdicts.map(v => v.allowed)).toEqual([true, true, false, false]);
  });

  it("marks every degraded verdict, allowed or not", async () => {
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const b = bucket();
    expect((await rateLimit(b, { limit: 1, windowSec: 60 })).degraded).toBe(true);   // allowed
    expect((await rateLimit(b, { limit: 1, windowSec: 60 })).degraded).toBe(true);   // refused
  });

  it("gives a usable retry-after rather than zero", async () => {
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const b = bucket();
    await rateLimit(b, { limit: 1, windowSec: 30 });
    const refused = await rateLimit(b, { limit: 1, windowSec: 30 });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);
    expect(refused.retryAfterSec).toBeLessThanOrEqual(30);
  });

  it("counts separate buckets separately", async () => {
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const a = bucket(), b = bucket();
    await rateLimit(a, { limit: 1, windowSec: 60 });
    expect((await rateLimit(a, { limit: 1, windowSec: 60 })).allowed).toBe(false);
    expect((await rateLimit(b, { limit: 1, windowSec: 60 })).allowed).toBe(true);
  });

  it("keeps counting a caller who is already over, so pausing earns nothing", async () => {
    // Same rule the SQL version follows: the increment happens even on a
    // refusal, or a client that backs off for one request gets a free one.
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const b = bucket();
    for (let i = 0; i < 5; i++) await rateLimit(b, { limit: 1, windowSec: 60 });
    expect((await rateLimit(b, { limit: 1, windowSec: 60 })).allowed).toBe(false);
  });

  it("refuses a zero limit, which is what the health probe relies on", async () => {
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const v = await rateLimit("health:probe", { limit: 0, windowSec: 1 });
    expect(v.allowed).toBe(false);
    // …and says it was the fallback, so the board cannot read this as proof
    // that the real limiter is running. This is the pair that matters.
    expect(v.degraded).toBe(true);
  });

  it("treats a malformed response the same as an outage", async () => {
    rpc = async () => ({ data: [{ nonsense: true }], error: null });
    const { rateLimit } = await import("../ratelimit");
    const v = await rateLimit(bucket(), { limit: 1, windowSec: 60 });
    expect(v.degraded).toBe(true);
  });

  it("treats a thrown client the same as an outage", async () => {
    rpc = async () => { throw new Error("socket hang up"); };
    const { rateLimit } = await import("../ratelimit");
    const v = await rateLimit(bucket(), { limit: 1, windowSec: 60 });
    expect(v.degraded).toBe(true);
  });

  it("does not log once per request during a flood", async () => {
    // An outage plus a flood is exactly when per-request logging turns a
    // database problem into a log-volume problem.
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    spy.mockClear();
    for (let i = 0; i < 50; i++) await rateLimit(bucket(), { limit: 10, windowSec: 60 });
    expect(spy.mock.calls.length).toBe(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/NOT being enforced/);
  });

  it("does not grow without bound", async () => {
    // A flood with a varying bucket is the only thing that fills this, and it
    // must not be able to fill it forever.
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    for (let i = 0; i < 6000; i++) await rateLimit(`flood:${i}`, { limit: 1, windowSec: 600 });
    // Still answering correctly after the eviction, which is the observable
    // part — a fresh bucket gets a fresh window.
    const v = await rateLimit("flood:after", { limit: 1, windowSec: 600 });
    expect(v).toMatchObject({ allowed: true, degraded: true });
  });
});

describe("recovery", () => {
  it("goes straight back to the shared counter when it returns", async () => {
    rpc = DOWN;
    const { rateLimit } = await import("../ratelimit");
    const b = bucket();
    expect((await rateLimit(b, { limit: 1, windowSec: 60 })).degraded).toBe(true);

    rpc = async () => ({ data: [{ allowed: true, retry_after: 0 }], error: null });
    const v = await rateLimit(b, { limit: 1, windowSec: 60 });
    expect(v.allowed).toBe(true);
    expect(v.degraded).toBeFalsy();     // no stickiness, no cached outage
  });
});
