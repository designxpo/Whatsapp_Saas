import { describe, it, expect, vi, afterEach } from "vitest";

// The unsubscribe token is the ONLY authorisation on a public endpoint that
// mutates a workspace's settings. These tests cover the two ways that goes
// wrong: a token that verifies when it shouldn't (someone edits the tenant id
// in the URL and opts out another workspace), and a token that fails to verify
// when it should (every recipient hits a dead link).

vi.mock("../store", () => ({
  getTenantSetting: vi.fn(async () => false),
  setTenantSetting: vi.fn(async () => undefined),
}));

const SECRET = "a".repeat(32);
const ORIGINAL = process.env.ADMIN_JWT_SECRET;

async function load() {
  vi.resetModules();
  return import("../emailprefs");
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_JWT_SECRET;
  else process.env.ADMIN_JWT_SECRET = ORIGINAL;
});

function tokenFrom(url: string): string {
  return new URL(url).searchParams.get("t") ?? "";
}

describe("unsubscribe token", () => {
  it("round-trips the tenant and stream it was signed for", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { unsubscribeUrl, verifyUnsubscribeToken } = await load();
    const url = unsubscribeUrl("tenant-abc", "weekly_recap");
    expect(url).toContain("/api/email/unsubscribe?t=");
    expect(verifyUnsubscribeToken(tokenFrom(url))).toEqual({ tenantId: "tenant-abc", kind: "weekly_recap" });
  });

  it("rejects a token whose tenant id was swapped — the whole point of signing it", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { unsubscribeUrl, verifyUnsubscribeToken } = await load();
    const token = tokenFrom(unsubscribeUrl("tenant-abc", "weekly_recap"));
    const [, kind, sig] = token.split(".");
    expect(verifyUnsubscribeToken(`victim-tenant.${kind}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature, a truncated one, and junk", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { unsubscribeUrl, verifyUnsubscribeToken } = await load();
    const token = tokenFrom(unsubscribeUrl("tenant-abc", "weekly_recap"));
    const [t, kind, sig] = token.split(".");
    expect(verifyUnsubscribeToken(`${t}.${kind}.${sig.slice(0, -1)}x`)).toBeNull();
    // A short signature must be rejected, not crash: timingSafeEqual throws on
    // a length mismatch, so the length check has to come first.
    expect(() => verifyUnsubscribeToken(`${t}.${kind}.abc`)).not.toThrow();
    expect(verifyUnsubscribeToken(`${t}.${kind}.abc`)).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("only.two")).toBeNull();
    expect(verifyUnsubscribeToken("a.not_a_stream.b")).toBeNull();
  });

  it("does not accept a token signed with a different secret", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const first = await load();
    const token = tokenFrom(first.unsubscribeUrl("tenant-abc", "weekly_recap"));
    process.env.ADMIN_JWT_SECRET = "b".repeat(32);
    const second = await load();
    expect(second.verifyUnsubscribeToken(token)).toBeNull();
  });

  it("survives a tenant id containing URL-significant characters", async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    const { unsubscribeUrl, verifyUnsubscribeToken } = await load();
    const weird = "tenant.with&odd=chars";
    const token = tokenFrom(unsubscribeUrl(weird, "weekly_recap"));
    expect(verifyUnsubscribeToken(token)).toEqual({ tenantId: weird, kind: "weekly_recap" });
  });
});

describe("unsubscribe link without a configured secret", () => {
  it("falls back to mailto so the email stays compliant instead of shipping a dead link", async () => {
    delete process.env.ADMIN_JWT_SECRET;
    const { unsubscribeUrl, verifyUnsubscribeToken } = await load();
    const url = unsubscribeUrl("tenant-abc", "weekly_recap");
    expect(url.startsWith("mailto:")).toBe(true);
    expect(url).toContain("subject=");
    // And nothing verifies, so no opt-out can be forged in that state either.
    expect(verifyUnsubscribeToken("anything.weekly_recap.sig")).toBeNull();
  });

  it("treats a too-short secret as unconfigured rather than signing weakly", async () => {
    process.env.ADMIN_JWT_SECRET = "short";
    const { unsubscribeUrl } = await load();
    expect(unsubscribeUrl("tenant-abc", "weekly_recap").startsWith("mailto:")).toBe(true);
  });
});
