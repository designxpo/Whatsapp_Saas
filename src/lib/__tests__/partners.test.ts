// White-label partners, Phase 1. The isolation rule every later phase builds on:
// one partner can never read, claim or release another partner's workspace,
// and the platform's own workspace belongs to nobody. The fake database below
// records every filter a query sends, so these tests check what reaches
// Postgres, not what the code meant to do.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
const calls: Call[] = [];
let tenantRow: Record<string, unknown> | null = null;
let partnerRow: Record<string, unknown> | null = null;
let updateReturns: unknown[] = [{ id: "t1" }];

function builder(table: string) {
  const c: Call = { table, op: "select", filters: [] };
  calls.push(c);
  const b: Record<string, unknown> = {};
  const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b; };
  b.select = chain(() => {});
  b.order = chain(() => {});
  b.limit = chain(() => {});
  b.eq = chain((col, v) => c.filters.push(["eq", col as string, v]));
  b.is = chain((col, v) => c.filters.push(["is", col as string, v]));
  b.update = chain(p => { c.op = "update"; c.payload = p; });
  b.insert = chain(p => { c.op = "insert"; c.payload = p; });
  const result = () => {
    if (c.op === "update") return { data: updateReturns, error: null };
    if (table === "wa_partners") return { data: partnerRow, error: null };
    return { data: tenantRow, error: null };
  };
  b.maybeSingle = () => Promise.resolve(result());
  b.single = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(c.op === "select" && table === "tenants" ? { data: tenantRow ? [tenantRow] : [], error: null } : result()).then(res);
  return b;
}
vi.mock("../supabase", () => ({ db: () => ({ from: (t: string) => builder(t) }) }));

import {
  checkPartnerInput, checkAssignment, normalizeSlug, PARTNER_DEFAULTS,
  partnerWorkspaces, getPartnerWorkspace, assignWorkspace, removeWorkspace,
} from "../partners";

const DEFAULT = "00000000-0000-0000-0000-000000000001";
const P1 = { id: "p1", status: "active" as const, allowedPlans: ["growth", "scale"] };

beforeEach(() => { calls.length = 0; tenantRow = null; partnerRow = null; updateReturns = [{ id: "t1" }]; });

describe("checkPartnerInput", () => {
  it("gives a new Private Label the business-plan prices", () => {
    const r = checkPartnerInput({ name: "Bright Dental", kind: "private" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({ name: "Bright Dental", slug: "bright-dental", kind: "private", tier: "standard",
      setup_fee_cents: 25_000_00, monthly_fee_cents: 4_999_00, deposit_cents: 0, wholesale_pct: null, allowed_plans: ["growth", "scale"] });
  });

  it("gives a new Reseller Pro its platform fee, deposit and wholesale share", () => {
    const r = checkPartnerInput({ name: "Agency X", kind: "reseller", tier: "pro" });
    expect(r.ok && r.row).toMatchObject({ setup_fee_cents: 1_00_000_00, monthly_fee_cents: 19_999_00, deposit_cents: 40_000_00, wholesale_pct: 50 });
    expect(PARTNER_DEFAULTS.reseller.pro.allowedPlans).toContain("creator");
  });

  it("keeps prices the owner typed instead of the defaults", () => {
    const r = checkPartnerInput({ name: "Agency X", kind: "reseller", monthlyFeeCents: 7_999_00, wholesalePct: 45 });
    expect(r.ok && r.row).toMatchObject({ monthly_fee_cents: 7_999_00, wholesale_pct: 45 });
  });

  it("refuses reserved addresses, bad emails, missing names and impossible shares", () => {
    expect(checkPartnerInput({ name: "App", kind: "private" }).ok).toBe(false);
    expect(checkPartnerInput({ name: "X", kind: "private" }).ok).toBe(false);
    expect(checkPartnerInput({ name: "Good Co", kind: "private", contactEmail: "nope" }).ok).toBe(false);
    expect(checkPartnerInput({ name: "Good Co", kind: "reseller", wholesalePct: 0 }).ok).toBe(false);
    expect(checkPartnerInput({ name: "Good Co", kind: "other" }).ok).toBe(false);
  });

  it("never lets a partner's kind change after creation", () => {
    const r = checkPartnerInput({ kind: "reseller" }, { kind: "private", tier: "standard" });
    expect(r.ok).toBe(false);
  });

  it("an update only touches the fields sent", () => {
    const r = checkPartnerInput({ contactName: "Asha" }, { kind: "reseller", tier: "standard" });
    expect(r.ok && r.row).toEqual({ contact_name: "Asha" });
  });

  it("turns any name into a safe address", () => {
    expect(normalizeSlug("  Bright Dental & Co.  ")).toBe("bright-dental-co");
  });
});

describe("checkAssignment", () => {
  it("never gives the platform's own workspace to a partner", () => {
    expect(checkAssignment(P1, { id: DEFAULT, plan: "growth", partnerId: null })).toMatch(/platform/);
  });
  it("refuses a workspace another partner owns", () => {
    expect(checkAssignment(P1, { id: "t1", plan: "growth", partnerId: "p2" })).toMatch(/another partner/);
  });
  it("refuses a plan the partner can't use", () => {
    expect(checkAssignment(P1, { id: "t1", plan: "starter", partnerId: null })).toMatch(/starter/);
  });
  it("refuses a closed partner", () => {
    expect(checkAssignment({ ...P1, status: "closed" }, { id: "t1", plan: "growth", partnerId: null })).toMatch(/closed/);
  });
  it("allows a free workspace on an allowed plan", () => {
    expect(checkAssignment(P1, { id: "t1", plan: "growth", partnerId: null })).toBeNull();
  });
});

describe("isolation at the database", () => {
  it("lists a partner's workspaces filtered by partner_id", async () => {
    await partnerWorkspaces("p1");
    const q = calls.find(c => c.table === "tenants")!;
    expect(q.filters).toContainEqual(["eq", "partner_id", "p1"]);
  });

  it("reads one workspace only together with its partner", async () => {
    await getPartnerWorkspace("p1", "t9");
    const q = calls.find(c => c.table === "tenants")!;
    expect(q.filters).toEqual(expect.arrayContaining([["eq", "id", "t9"], ["eq", "partner_id", "p1"]]));
  });

  it("claims a workspace only while it is still partner-less", async () => {
    partnerRow = { id: "p1", status: "active", allowed_plans: ["growth"], kind: "private", tier: "standard" };
    tenantRow = { id: "t1", plan: "growth", partner_id: null };
    const r = await assignWorkspace("p1", "t1", "owner@x");
    expect(r.ok).toBe(true);
    const up = calls.find(c => c.table === "tenants" && c.op === "update")!;
    expect(up.payload).toEqual({ partner_id: "p1" });
    expect(up.filters).toEqual(expect.arrayContaining([["eq", "id", "t1"], ["is", "partner_id", null]]));
  });

  it("does not touch the database for the platform's own workspace", async () => {
    const r = await assignWorkspace("p1", DEFAULT, "owner@x");
    expect(r.error).toMatch(/platform/);
    expect(calls.length).toBe(0);
  });

  it("refuses a workspace that another partner holds, without writing", async () => {
    partnerRow = { id: "p1", status: "active", allowed_plans: ["growth"], kind: "private", tier: "standard" };
    tenantRow = { id: "t1", plan: "growth", partner_id: "p2" };
    const r = await assignWorkspace("p1", "t1", "owner@x");
    expect(r.error).toMatch(/another partner/);
    expect(calls.some(c => c.op === "update")).toBe(false);
  });

  it("releases a workspace only from the partner that owns it", async () => {
    updateReturns = [];
    const r = await removeWorkspace("p1", "t1", "owner@x");
    expect(r.error).toMatch(/doesn't belong/);
    const up = calls.find(c => c.table === "tenants" && c.op === "update")!;
    expect(up.filters).toEqual(expect.arrayContaining([["eq", "id", "t1"], ["eq", "partner_id", "p1"]]));
  });
});
