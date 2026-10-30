// The owner console must show the state a tenant is actually in. A trial that
// runs out is never rewritten in the database: accountState() works it out live
// (and that is what locks the workspace), so `tenants.status` keeps saying
// "trialing" forever. The console used to print that stored value, plus
// "trial 20h overdue" — which read like an unpaid bill on an account that was
// still on trial, when the workspace had in fact been locked for days.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consoleStatus } from "../entitlement-registry";

const HOUR = 3_600_000;
const past = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
const future = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the status the owner console shows", () => {
  it("a trial past its end date is 'trial_ended', not 'trialing'", () => {
    expect(consoleStatus({ status: "trialing", paymentStatus: "trialing", trialEndsAt: past(20) })).toBe("trial_ended");
    expect(consoleStatus({ status: "trialing", paymentStatus: "none", trialEndsAt: past(24 * 60) })).toBe("trial_ended");
  });
  it("a trial still running stays 'trialing'", () => {
    expect(consoleStatus({ status: "trialing", paymentStatus: "trialing", trialEndsAt: future(44) })).toBe("trialing");
    expect(consoleStatus({ status: "trialing", paymentStatus: "trialing", trialEndsAt: null })).toBe("trialing");
  });
  it("a paying, suspended or cancelled tenant keeps its own status, whatever its old trial date", () => {
    expect(consoleStatus({ status: "active", paymentStatus: "active", trialEndsAt: past(24 * 90) })).toBe("active");
    expect(consoleStatus({ status: "suspended", paymentStatus: "none", trialEndsAt: past(24 * 90) })).toBe("suspended");
    expect(consoleStatus({ status: "cancelled", paymentStatus: "cancelled", trialEndsAt: past(5) })).toBe("cancelled");
  });
  it("agrees with the lock: 'trial_ended' exactly when accountState() says trial_expired", async () => {
    const { accountState } = await import("../entitlement-registry");
    const cases = [
      { status: "trialing", paymentStatus: "trialing", trialEndsAt: past(1) },
      { status: "active", paymentStatus: "trialing", trialEndsAt: past(1) },
      { status: "trialing", paymentStatus: "past_due", trialEndsAt: past(1) },
      { status: "trialing", paymentStatus: "trialing", trialEndsAt: future(1) },
      { status: "active", paymentStatus: "none", trialEndsAt: past(1) },
    ];
    for (const c of cases) {
      const locked = accountState({ ...c, enforcing: true } as never).state === "trial_expired";
      expect(consoleStatus(c) === "trial_ended", JSON.stringify(c)).toBe(locked);
    }
  });
});

describe("the tenant list and drawer", () => {
  for (const f of ["src/app/admin/owner/tenants/page.tsx", "src/app/admin/owner/tenants/_drawer.tsx"]) {
    it(`${f.split("/").pop()} shows the live status, and never calls an ended trial "overdue"`, () => {
      const src = read(f);
      expect(src).toMatch(/consoleStatus\(t\)/);
      expect(src).not.toMatch(/<Badge tone=\{STATUS_TONE\[t\.status\][^>]*>\{t\.status\}<\/Badge>/);
      expect(src).not.toMatch(/trial \{(t\.trialEndsAt \? )?until\(t\.trialEndsAt\)/);
    });
  }
});
