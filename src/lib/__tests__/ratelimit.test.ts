// The limiter itself, and the fact that it is actually wired into the two
// surfaces that needed it.
//
// The realistic failures here are not "it miscounts". They are:
//
//   • it is written but never called, so the surface is exactly as open as
//     before while looking protected
//   • it refuses real visitors during a database problem, turning an outage
//     into a customer-visible outage on their own website
//   • it silently stops counting and nobody finds out
import { describe, it, expect, beforeEach, vi } from "vitest";

let rpcResult: { data: unknown; error: unknown } = { data: [{ allowed: true, retry_after: 0 }], error: null };
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcThrows = false;

vi.mock("../supabase", () => ({
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (rpcThrows) throw new Error("socket hang up");
      return rpcResult;
    },
  }),
}));

const deny = () => { rpcResult = { data: [{ allowed: false, retry_after: 42 }], error: null }; };
const allow = () => { rpcResult = { data: [{ allowed: true, retry_after: 0 }], error: null }; };

beforeEach(() => {
  allow();
  rpcCalls = [];
  rpcThrows = false;
  vi.restoreAllMocks();
});

const req = (headers: Record<string, string> = {}) => new Request("https://x.test/", { headers });

describe("who is being counted", () => {
  it("takes the first address in x-forwarded-for", async () => {
    // The left-most entry is the client; everything after it is a proxy.
    const { clientIp } = await import("../ratelimit");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then to a constant", async () => {
    const { clientIp } = await import("../ratelimit");
    expect(clientIp(req({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(req())).toBe("unknown");
  });

  it("cannot be made enormous by the caller", async () => {
    const { clientIp } = await import("../ratelimit");
    expect(clientIp(req({ "x-forwarded-for": "a".repeat(5000) })).length).toBeLessThanOrEqual(60);
  });
});

describe("counting", () => {
  it("allows a request under the limit", async () => {
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    expect(await rateLimit("b", CONTACT_PER_IP)).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it("refuses one over it, and says for how long", async () => {
    deny();
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    expect(await rateLimit("b", CONTACT_PER_IP)).toEqual({ allowed: false, retryAfterSec: 42 });
  });

  it("counts through ONE atomic statement, not a read then a write", async () => {
    // A read-then-write limiter is a race, and under a flood — the exact
    // condition it exists for — concurrent requests all read the same count and
    // all decide they are under the limit. This codebase has already paid for
    // that once on the send queue.
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    await rateLimit("bucket-x", CONTACT_PER_IP);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("rate_limit_hit");
    expect(rpcCalls[0].args.p_bucket).toBe("bucket-x");
    expect(rpcCalls[0].args.p_limit).toBe(CONTACT_PER_IP.limit);
  });

  it("truncates an oversized bucket key", async () => {
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    await rateLimit("k".repeat(9000), CONTACT_PER_IP);
    expect(String(rpcCalls[0].args.p_bucket).length).toBe(200);
  });
});

describe("when the counter cannot be read", () => {
  it("allows the request, and says so loudly", async () => {
    // Deliberate. Every caller this protects needs the database on its next
    // line, so refusing here converts an outage into a different outage while
    // protecting nothing. Silence is the part that would be wrong.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResult = { data: null, error: { message: "function does not exist" } };
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    expect((await rateLimit("b", CONTACT_PER_IP)).allowed).toBe(true);
    expect(err).toHaveBeenCalled();
  });

  it("allows the request when the call throws outright", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcThrows = true;
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    expect((await rateLimit("b", CONTACT_PER_IP)).allowed).toBe(true);
  });

  it("allows the request when the answer is a shape nobody expected", async () => {
    rpcResult = { data: [{ nonsense: true }], error: null };
    const { rateLimit, CONTACT_PER_IP } = await import("../ratelimit");
    expect((await rateLimit("b", CONTACT_PER_IP)).allowed).toBe(true);
  });
});

describe("several limits at once", () => {
  it("checks the narrowest bucket first", async () => {
    // Order matters: one abusive address should fill its OWN bucket rather
    // than being counted against the whole site and throttling everybody else.
    const { rateLimitAll, CONTACT_PER_IP, apiPerKey } = await import("../ratelimit");
    await rateLimitAll([
      { bucket: "narrow", limit: CONTACT_PER_IP },
      { bucket: "wide", limit: apiPerKey() },
    ]);
    expect(rpcCalls.map(c => c.args.p_bucket)).toEqual(["narrow", "wide"]);
  });

  it("stops at the first refusal", async () => {
    deny();
    const { rateLimitAll, CONTACT_PER_IP, apiPerKey } = await import("../ratelimit");
    const v = await rateLimitAll([
      { bucket: "narrow", limit: CONTACT_PER_IP },
      { bucket: "wide", limit: apiPerKey() },
    ]);
    expect(v.allowed).toBe(false);
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("the limits themselves", () => {


  it("can be raised without a code change when it bites a real customer", async () => {
    vi.stubEnv("API_KEY_LIMIT", "9000");
    const { apiPerKey } = await import("../ratelimit");
    expect(apiPerKey().limit).toBe(9000);
    vi.unstubAllEnvs();
  });

  it("ignores a nonsense override rather than becoming unlimited", async () => {
    // "0" or "abc" must not read as "no limit".
    for (const bad of ["0", "-5", "abc", ""]) {
      vi.stubEnv("API_KEY_LIMIT", bad);
      const { apiPerKey } = await import("../ratelimit");
      expect(apiPerKey().limit, bad).toBe(600);
    }
    vi.unstubAllEnvs();
  });
});
