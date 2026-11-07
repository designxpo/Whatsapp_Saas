// payout_details_enc (the encrypted bank/UPI blob) must never leave the
// database layer: not through a serializer, not through an API response.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { makeFakeDb, type Fake } from "./helpers/affiliate-fakedb";

const h = vi.hoisted(() => ({ fake: null as Fake | null }));
vi.mock("../supabase", () => ({ db: () => h.fake!.client }));
vi.mock("../tenants", () => ({ ownerAudit: async () => {} }));
vi.mock("../email", () => ({ sendEmail: async () => ({ ok: true }) }));

import { getAffiliate, listCommissions } from "../affiliates";
import { getPayoutAccountStatus, listOwnerPayoutData } from "../affiliate-payouts";

const BLOB = "v1:SECRETIV:SECRETTAG:SECRETCIPHERTEXT";
const AFF = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  h.fake = makeFakeDb();
  h.fake.tables.wa_affiliates.push({ id: AFF, email: "a@b.co", name: "A B", phone: null, code: "C", commission_pct: 10, status: "active", payout_method: null, created_at: "2026-01-01",
    password_hash: "HASH", payout_details_enc: BLOB, payout_kind: "bank", payout_last4: "9012", payout_name: "A B", rzpx_fund_account_id: "fa_1", payout_verified_at: "2026-02-01", payout_changed_at: "2026-01-02", risk_hold: false });
});

describe("payout_details_enc never leaves the data layer", () => {
  it("is not in the Affiliate object the rest of the app receives", async () => {
    const a = await getAffiliate(AFF);
    expect(JSON.stringify(a)).not.toMatch(/SECRETCIPHERTEXT|payout_details_enc|password_hash|HASH/);
  });
  it("is not in what the affiliate sees of their payout account", async () => {
    const s = JSON.stringify(await getPayoutAccountStatus(AFF));
    expect(s).not.toMatch(/SECRET|payout_details_enc|fa_1/);
    expect(s).toContain("9012");   // masked last 4 only
  });
  it("is not in the owner payout dashboard", async () => {
    const s = JSON.stringify(await listOwnerPayoutData());
    expect(s).not.toMatch(/SECRET|payout_details_enc|password_hash|HASH/);
  });
  it("is never selected by the affiliate payout queries (explicit column lists only)", async () => {
    await getPayoutAccountStatus(AFF); await listOwnerPayoutData(); await listCommissions(AFF);
    for (const s of h.fake!.selects.filter(s => s.table === "wa_affiliates")) {
      if (s.cols !== "*") expect(s.cols).not.toMatch(/payout_details_enc|password_hash/);
    }
  });
});

describe("source guard", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p); }
    return out;
  }
  it("only the payout library writes the column; no route or page references it", () => {
    const root = join(__dirname, "..", "..");   // src/
    const offenders = walk(root).filter(f => !f.includes("__tests__") && readFileSync(f, "utf8").includes("payout_details_enc")).map(f => f.slice(root.length));
    expect(offenders).toEqual(["/lib/affiliate-payouts.ts"]);
  });
  it("no route handler selects wa_affiliates with *", () => {
    const routes = walk(join(__dirname, "..", "..", "app", "api")).filter(f => /affiliate/i.test(f));
    for (const f of routes) expect(readFileSync(f, "utf8")).not.toMatch(/from\("wa_affiliates"\)\s*\.select\("\*"\)/);
  });
});
