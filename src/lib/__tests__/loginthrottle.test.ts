// Login brute-force throttle: the per-IP key alone let many addresses guess one
// account (the IP is a header the caller sets). An account-wide key now sits
// beside it — higher threshold, and a lock that always runs out, so a stranger
// typing someone's email can't keep them out for good.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: new Map<string, string[]>(),   // key → created_at ISO strings
  fail: false,                         // simulate the table being missing
  inserted: [] as string[],
  deleted: [] as string[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: () => {
      let key = "";
      let since = "";
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_c: string, v: string) => { key = v; return b; };
      b.gte = (_c: string, v: string) => { since = v; return b; };
      b.order = () => Promise.resolve(h.fail
        ? { data: null, error: { message: "relation does not exist" } }
        : { data: (h.rows.get(key) ?? []).filter(t => t >= since).sort().reverse().map(created_at => ({ created_at })), error: null });
      b.insert = (rows: { key: string }[]) => { h.inserted.push(...rows.map(r => r.key)); return Promise.resolve({ error: null }); };
      b.delete = () => ({ in: (_c: string, keys: string[]) => { h.deleted.push(...keys); return Promise.resolve({ error: null }); } });
      return b;
    },
  }),
}));

import {
  loginKey, accountKey, lockState, lockedMessage, loginThrottle, loginThrottleBoth,
  recordLoginFailure, clearLoginFailures, KEY_LIMITS, ACCOUNT_LIMITS,
} from "../loginthrottle";

const req = (ip: string) => new Request("http://x/api/admin/login", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
const MIN = 60_000;
const NOW = Date.parse("2026-11-06T12:00:00Z");
const ago = (n: number, mins: number) => Array.from({ length: n }, (_, i) => NOW - mins * MIN - i * 1000);
const iso = (ms: number[]) => ms.map(t => new Date(t).toISOString());

beforeEach(() => { h.rows.clear(); h.fail = false; h.inserted.length = 0; h.deleted.length = 0; });

describe("throttle keys", () => {
  it("the per-IP key changes with the address; the account key does not", () => {
    expect(loginKey(req("1.1.1.1"), "Owner@Example.com")).toBe("1.1.1.1:owner@example.com");
    expect(loginKey(req("2.2.2.2"), "owner@example.com")).not.toBe(loginKey(req("1.1.1.1"), "owner@example.com"));
    expect(accountKey(" Owner@Example.com ")).toBe("acct:owner@example.com");
    expect(accountKey("owner@example.com")).toBe(accountKey("OWNER@example.com"));
  });

  it("a forged X-Forwarded-For can't make the IP key equal the account key", () => {
    // Unfiltered, "acct" + ":" + "x" would BE accountKey("x"), and every
    // failure would count twice against the account-wide lock.
    expect(loginKey(req("acct"), "x")).not.toBe(accountKey("x"));
    expect(loginKey(req("acct"), "x").startsWith("acct:")).toBe(false);
    expect(loginKey(req("2001:db8::1"), "x")).toBe("2001:db8::1:x");
    expect(loginKey(req("<script>"), "x")).toBe("c:x");
    expect(loginKey(new Request("http://x"), "x")).toBe("unknown:x");
  });
});

describe("lockState", () => {
  it("per-IP: locks on the 5th failure in 15 minutes, for 15 minutes", () => {
    expect(lockState(ago(4, 1), NOW, KEY_LIMITS).allowed).toBe(true);
    const v = lockState(ago(5, 1), NOW, KEY_LIMITS);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSec).toBe(14 * 60);
    // failures older than the window don't count
    expect(lockState(ago(5, 16), NOW, KEY_LIMITS).allowed).toBe(true);
  });

  it("account-wide: needs 20 failures in an hour", () => {
    expect(lockState(ago(19, 5), NOW, ACCOUNT_LIMITS).allowed).toBe(true);
    const v = lockState(ago(20, 5), NOW, ACCOUNT_LIMITS);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSec).toBe(25 * 60);
    expect(lockState(ago(20, 61), NOW, ACCOUNT_LIMITS).allowed).toBe(true);
  });

  it("account-wide lock expires 30 minutes after the last failure even with 20 still in the window", () => {
    // 20 failures, the newest 31 minutes ago — still inside the hour, lock over.
    expect(lockState(ago(20, 31), NOW, ACCOUNT_LIMITS).allowed).toBe(true);
    expect(lockState(ago(20, 29), NOW, ACCOUNT_LIMITS).allowed).toBe(false);
  });

  it("ignores garbage timestamps", () => {
    expect(lockState([NaN, NaN, NaN, NaN, NaN], NOW, KEY_LIMITS).allowed).toBe(true);
  });
});

describe("lockedMessage", () => {
  it("says how long to wait, in plain English", () => {
    expect(lockedMessage(25 * 60)).toBe("Too many failed sign-in attempts. Please wait about 25 minutes and try again.");
    expect(lockedMessage(30)).toBe("Too many failed sign-in attempts. Please wait about 1 minute and try again.");
    expect(lockedMessage(undefined)).toMatch(/about 15 minutes/);
  });
});

describe("loginThrottleBoth (database-backed)", () => {
  it("many addresses guessing one account: each IP key is clean, the account key locks", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const acct = accountKey("victim@example.com");
      h.rows.set(acct, iso(ago(20, 2)));
      const ipKey = loginKey(req("9.9.9.9"), "victim@example.com");
      expect((await loginThrottle(ipKey)).allowed).toBe(true);
      const v = await loginThrottleBoth(ipKey, acct);
      expect(v.allowed).toBe(false);
      expect(v.retryAfterSec).toBe(28 * 60);
    } finally { vi.useRealTimers(); }
  });

  it("takes the longer wait when both are locked", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    try {
      const ipKey = loginKey(req("1.1.1.1"), "a@b.co");
      const acct = accountKey("a@b.co");
      h.rows.set(ipKey, iso(ago(5, 0)));
      h.rows.set(acct, iso(ago(20, 0)));
      expect((await loginThrottleBoth(ipKey, acct)).retryAfterSec).toBe(30 * 60);
    } finally { vi.useRealTimers(); }
  });

  it("degrades open when the attempts table is missing", async () => {
    h.fail = true;
    expect(await loginThrottleBoth("k", accountKey("a@b.co"))).toEqual({ allowed: true });
  });

  it("records and clears every key it is given", async () => {
    await recordLoginFailure("ip-key", "acct:a@b.co");
    expect(h.inserted).toEqual(["ip-key", "acct:a@b.co"]);
    await clearLoginFailures("ip-key", "acct:a@b.co");
    expect(h.deleted).toEqual(["ip-key", "acct:a@b.co"]);
  });
});
