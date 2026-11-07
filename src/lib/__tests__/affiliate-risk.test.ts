import { describe, it, expect, afterEach } from "vitest";
import { isSelfReferral, velocityFlag, payableAt, decideRefund, nameMatches, normalizePhone, affiliateHoldDays, FREE_EMAIL_DOMAINS } from "../affiliate-risk";

const AFF = { email: "asha@acme.io", phone: "+91 98765 43210", createdAt: "2026-10-01T00:00:00Z" };
const TENANT = { email: "buyer@other.com", phone: "99999 00000", createdAt: "2026-10-05T00:00:00Z" };

describe("isSelfReferral", () => {
  it("passes an unrelated referral", () => expect(isSelfReferral(AFF, TENANT)).toEqual({ flagged: false, reasons: [] }));
  it("flags the same email, case and spacing insensitive", () => {
    expect(isSelfReferral(AFF, { ...TENANT, email: "  ASHA@acme.io " }).reasons).toContain("same_email");
  });
  it("flags the same phone by last 10 digits, whatever the formatting", () => {
    expect(isSelfReferral(AFF, { ...TENANT, phone: "09876543210" }).reasons).toContain("same_phone");
    expect(isSelfReferral(AFF, { ...TENANT, phone: "+91-98765-43210" }).reasons).toContain("same_phone");
  });
  it("flags the same company email domain but never a shared free-mail domain", () => {
    expect(isSelfReferral(AFF, { ...TENANT, email: "bob@acme.io" }).reasons).toContain("same_email_domain");
    expect(isSelfReferral({ ...AFF, email: "a@gmail.com" }, { ...TENANT, email: "b@gmail.com" }).flagged).toBe(false);
    for (const d of ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "rediffmail.com"]) expect(FREE_EMAIL_DOMAINS.has(d)).toBe(true);
  });
  it("flags a tenant created before the affiliate enrolled", () => {
    expect(isSelfReferral(AFF, { ...TENANT, createdAt: "2026-09-01T00:00:00Z" }).reasons).toContain("tenant_predates_affiliate");
  });
  it("collects every reason", () => {
    const v = isSelfReferral(AFF, { email: "asha@acme.io", phone: "9876543210", createdAt: "2026-09-01T00:00:00Z" });
    expect(v.reasons).toEqual(expect.arrayContaining(["same_email", "same_phone", "same_email_domain", "tenant_predates_affiliate"]));
  });
  it("does not flag on missing data", () => expect(isSelfReferral({}, {}).flagged).toBe(false));
  it("normalizePhone needs 10 digits", () => { expect(normalizePhone("12345")).toBeNull(); expect(normalizePhone("+91 98765 43210")).toBe("9876543210"); });
});

describe("velocityFlag", () => {
  const h = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 3600_000).toISOString();
  it("flags 5 conversions inside 24h", () => expect(velocityFlag([h(0), h(1), h(2), h(3), h(4)])).toBe(true));
  it("does not flag 4", () => expect(velocityFlag([h(0), h(1), h(2), h(3)])).toBe(false));
  it("does not flag 5 spread over more than 24h", () => expect(velocityFlag([h(0), h(6), h(12), h(18), h(24)])).toBe(false));
  it("finds a burst inside a longer history, unsorted input", () => expect(velocityFlag([h(500), h(1), h(0), h(300), h(2), h(3), h(4)])).toBe(true));
  it("ignores junk timestamps", () => expect(velocityFlag(["nope", h(0)])).toBe(false));
});

describe("payableAt / hold", () => {
  afterEach(() => { delete process.env.AFFILIATE_HOLD_DAYS; });
  it("adds exactly the hold days", () => expect(payableAt("2026-11-01T10:00:00Z", 10).toISOString()).toBe("2026-11-11T10:00:00.000Z"));
  it("accepts a Date and a zero hold", () => expect(payableAt(new Date("2026-11-01T00:00:00Z"), 0).toISOString()).toBe("2026-11-01T00:00:00.000Z"));
  it("defaults to 10 days and honours the env override", () => {
    expect(affiliateHoldDays()).toBe(10);
    process.env.AFFILIATE_HOLD_DAYS = "3"; expect(affiliateHoldDays()).toBe(3);
    process.env.AFFILIATE_HOLD_DAYS = "-4"; expect(affiliateHoldDays()).toBe(10);
    process.env.AFFILIATE_HOLD_DAYS = "abc"; expect(affiliateHoldDays()).toBe(10);
  });
  it("rejects an invalid date", () => expect(() => payableAt("garbage")).toThrow());
});

describe("decideRefund", () => {
  it("voids a pending, unclaimed commission", () => expect(decideRefund({ status: "pending", commissionCents: 5000, payoutId: null })).toEqual({ action: "void" }));
  it("claws back a processing or paid commission", () => {
    expect(decideRefund({ status: "processing", commissionCents: 5000, payoutId: "p1" })).toEqual({ action: "clawback", cents: 5000 });
    expect(decideRefund({ status: "paid", commissionCents: 5000, payoutId: "p1" })).toEqual({ action: "clawback", cents: 5000 });
  });
  it("treats a pending row that already has a payout id as claimed", () => {
    expect(decideRefund({ status: "pending", commissionCents: 5000, payoutId: "p1" }).action).toBe("clawback");
  });
  it("scales a partial refund", () => expect(decideRefund({ status: "paid", commissionCents: 5000 }, 0.5)).toEqual({ action: "clawback", cents: 2500 }));
  it("does nothing for void rows and clawbacks", () => {
    expect(decideRefund({ status: "void", commissionCents: 5000 }).action).toBe("none");
    expect(decideRefund({ status: "paid", kind: "clawback", commissionCents: -5000 }).action).toBe("none");
  });
});

describe("nameMatches", () => {
  it("ignores case, punctuation, order and titles", () => {
    expect(nameMatches("PRIYESH KUMAR", "Priyesh Kumar")).toBe(true);
    expect(nameMatches("Kumar, Priyesh", "priyesh kumar")).toBe(true);
    expect(nameMatches("Mr. Priyesh  Kumar", "Priyesh Kumar")).toBe(true);
    expect(nameMatches("Priyésh Kumar", "Priyesh Kumar")).toBe(true);
  });
  it("tolerates initials and a middle name", () => {
    expect(nameMatches("R KUMAR", "Rahul Kumar")).toBe(true);
    expect(nameMatches("Rahul Kumar", "Rahul K Kumar")).toBe(true);
    expect(nameMatches("Rahul Kumar Sharma", "Rahul Sharma")).toBe(true);
  });
  it("rejects a different person", () => {
    expect(nameMatches("Rohit Sharma", "Rahul Sharma")).toBe(false);
    expect(nameMatches("Acme Traders", "Rahul Sharma")).toBe(false);
    expect(nameMatches("R K", "Rahul Kumar")).toBe(false);          // initials only: no full-word anchor
    expect(nameMatches("Rahul", "Rahul Sharma")).toBe(false);       // one word is not enough to vouch
  });
  it("rejects empty values", () => { expect(nameMatches("", "Rahul Kumar")).toBe(false); expect(nameMatches(null, null)).toBe(false); });
});
