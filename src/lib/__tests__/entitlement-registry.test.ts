// accountState() decides whether a workspace can send — and as of the
// trial-expiry paywall work, that decision now gates AI auto-replies, flows,
// sequences, the WhatsApp OTP API, manual Live Chat replies and comment
// automation, not just one broadcast route. A bug here doesn't just show a
// wrong banner any more — it can silently stop a PAYING customer's messages,
// or (the opposite failure) let an expired trial keep sending for free. Both
// directions are worth a direct, no-mocking-required test: this function is
// pure, so there's no excuse not to.

import { describe, it, expect } from "vitest";
import { accountState, type Entitlements } from "../entitlement-registry";

const HOUR = 60 * 60 * 1000;

function ent(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    features: {} as Entitlements["features"],
    limits: { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 0, team_seats: 0 },
    plan: "growth",
    status: "active",
    paymentStatus: "active",
    trialEndsAt: null,
    enforcing: true,
    grandfathered: false,
    ...overrides,
  };
}

describe("accountState", () => {
  it("is always ok when the enforcement kill-switch is off — even for an otherwise-blocked account", () => {
    const r = accountState(ent({ enforcing: false, status: "suspended", paymentStatus: "past_due" }));
    expect(r).toEqual({ state: "ok", active: true, message: "" });
  });

  it("treats a missing entitlements object the same as enforcement being off", () => {
    expect(accountState(null)).toEqual({ state: "ok", active: true, message: "" });
    expect(accountState(undefined)).toEqual({ state: "ok", active: true, message: "" });
  });

  it("is ok for a normal paying customer — the case that must never break", () => {
    const r = accountState(ent({ status: "active", paymentStatus: "active" }));
    expect(r.active).toBe(true);
    expect(r.state).toBe("ok");
  });

  it("is ok for a tenant mid-trial whose trial hasn't ended yet", () => {
    const r = accountState(ent({ status: "trialing", paymentStatus: "trialing", trialEndsAt: new Date(Date.now() + 24 * HOUR).toISOString() }));
    expect(r.active).toBe(true);
  });

  it("does not treat an open-ended trial (no trialEndsAt) as expired", () => {
    const r = accountState(ent({ status: "trialing", paymentStatus: "trialing", trialEndsAt: null }));
    expect(r.active).toBe(true);
  });

  it("blocks once trialEndsAt is in the past", () => {
    const r = accountState(ent({ status: "trialing", paymentStatus: "trialing", trialEndsAt: new Date(Date.now() - HOUR).toISOString() }));
    expect(r).toEqual({ state: "trial_expired", active: false, message: "Your free trial has ended. Choose a plan to keep using Talko AI." });
  });

  it("blocks on a past-due payment regardless of trial fields", () => {
    const r = accountState(ent({ status: "active", paymentStatus: "past_due", trialEndsAt: null }));
    expect(r.state).toBe("past_due");
    expect(r.active).toBe(false);
  });

  it("blocks a suspended workspace", () => {
    const r = accountState(ent({ status: "suspended" }));
    expect(r.state).toBe("suspended");
    expect(r.active).toBe(false);
  });

  it("blocks a cancelled workspace the same way as suspended", () => {
    const r = accountState(ent({ status: "cancelled" }));
    expect(r.state).toBe("suspended");
    expect(r.active).toBe(false);
  });

  it("suspended takes priority over an also-expired trial (one clear message, not a stale one)", () => {
    const r = accountState(ent({ status: "suspended", paymentStatus: "trialing", trialEndsAt: new Date(Date.now() - HOUR).toISOString() }));
    expect(r.state).toBe("suspended");
  });
});
