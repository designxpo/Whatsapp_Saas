// Sign-in security, one level per ACCOUNT for the platform owner. Emails are synthetic.
import { describe, it, expect, vi, beforeEach } from "vitest";

const DEF = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown[] | null; error: { message: string } | null }>,
  owner: true,
  pageReads: [] as string[],
}));

// Pages like PostgREST: .order().range(from, to), at most 1,000 rows each.
vi.mock("../supabase", () => {
  const client = { from: (t: string) => ({ select: () => {
    const q = {
      order: () => q,
      range: async (from: number, to: number) => {
        const tbl = h.tables[t] ?? { data: [], error: null };
        if (tbl.error) return { data: null, error: tbl.error };
        h.pageReads.push(t);
        return { data: (tbl.data ?? []).slice(from, Math.min(to + 1, from + 1000)), error: null };
      },
    };
    return q;
  } }) };
  return { db: () => client };
});
vi.mock("@/lib/auth", () => ({ isPlatformOwner: async () => h.owner }));

const { accountSecurity } = await import("../securitylevels");
const { securityReport } = await import("../securityposture");
const P = (role: string, twoFactor: boolean, passkeys = 0) => ({ role, twoFactor, passkeys, recoveryVerified: false });

describe("one level per account", () => {
  it("High risk: an admin has no authenticator app or passkey", () => {
    const a = accountSecurity([P("admin", false), P("admin", true, 1)]);
    expect(a.level).toBe("high");
    expect(a.reason).toBe("1 admin has no authenticator app or passkey.");
  });
  it("Partially secured: every admin covered, some members not", () => {
    expect(accountSecurity([P("admin", true), P("member", false)]).level).toBe("partial");
  });
  it("Secured: everyone covered, not everyone has a passkey", () => {
    expect(accountSecurity([P("admin", true, 1), P("member", true)]).level).toBe("good");
  });
  it("Fully secured: everyone has a passkey", () => {
    expect(accountSecurity([P("admin", false, 1), P("member", true, 2)]).level).toBe("secure");
  });
  it("an account nobody signs in to is not called secure", () => {
    expect(accountSecurity([]).level).toBe("empty");
  });
});

describe("the report across every business", () => {
  beforeEach(() => {
    process.env.ADMIN_USER = "owner@talko.test";
    h.pageReads = [];
    h.tables = {
      tenants: { error: null, data: [
        { id: DEF, name: "Talko", slug: "talko", status: "active" },
        { id: "t-acme", name: "Acme Tutors", slug: "acme", status: "active" },
        { id: "t-bloom", name: "Bloom Clinic", slug: "bloom", status: "trialing" },
      ] },
      wa_users: { error: null, data: [
        { email: "asha@acme.test", role: "admin", active: true, tenant_id: "t-acme" },
        { email: "ravi@acme.test", role: "member", active: true, tenant_id: "t-acme" },
        { email: "gone@bloom.test", role: "admin", active: false, tenant_id: "t-bloom" },
        { email: "meena@bloom.test", role: "admin", active: true, tenant_id: "t-bloom" },
      ] },
      wa_user_2fa: { error: null, data: [
        { email: "asha@acme.test", confirmed_at: "2026-10-01" },
        { email: "ravi@acme.test", confirmed_at: null },   // started, never confirmed
      ] },
      wa_user_passkeys: { error: null, data: [{ email: "owner@talko.test", credential_id: "c1" }] },
    };
  });

  it("levels every account, riskiest first, with counts and no names", async () => {
    const r = await securityReport();
    expect(r.accounts.map(a => [a.name, a.level])).toEqual([["Bloom Clinic", "high"], ["Acme Tutors", "partial"], ["Talko", "secure"]]);
    expect(r.counts).toMatchObject({ high: 1, partial: 1, secure: 1, good: 0 });
    expect(r.accounts.find(a => a.name === "Bloom Clinic")).toMatchObject({ people: 1, admins: 1 });   // deactivated admin left out
    expect(JSON.stringify(r)).not.toMatch(/@acme\.test|@bloom\.test|owner@/);
  });

  it("reads past PostgREST's 1,000-row cap", async () => {
    h.tables.wa_users = { error: null, data: Array.from({ length: 2500 }, (_, i) => ({ email: `m${i}@acme.test`, role: i === 2400 ? "admin" : "member", active: true, tenant_id: "t-acme" })) };
    const acme = (await securityReport()).accounts.find(a => a.name === "Acme Tutors")!;
    expect(acme.people).toBe(2500);
    expect(acme.level).toBe("high");
    expect(h.pageReads.filter(t => t === "wa_users")).toHaveLength(3);
  });

  it("claims nothing when a security table can't be read", async () => {
    h.tables.wa_user_passkeys = { data: null, error: { message: "relation does not exist" } };
    const r = await securityReport();
    expect(r).toMatchObject({ available: false, accounts: [] });
    expect(r.problem).toMatch(/passkeys/);
  });
});

describe("who can see it", () => {
  it("is owner-only", async () => {
    h.owner = false;
    const { GET } = await import("../../app/api/owner/security/route");
    expect((await GET(new Request("http://x/api/owner/security"))).status).toBe(403);
    h.owner = true;
  });

  it("filters by level and caps the list, while the counts cover everyone", async () => {
    h.owner = true;
    process.env.ADMIN_USER = "owner@talko.test";
    h.tables.tenants = { error: null, data: Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, name: `Biz ${i}`, slug: `b${i}`, status: "active" })) };
    h.tables.wa_users = { error: null, data: [] };
    h.tables.wa_user_2fa = { error: null, data: [] };
    h.tables.wa_user_passkeys = { error: null, data: [] };
    const { GET } = await import("../../app/api/owner/security/route");
    const d = await (await GET(new Request("http://x/api/owner/security?level=empty"))).json();
    expect(d.counts.empty).toBe(400);
    expect(d.matching).toBe(400);
    expect(d.accounts).toHaveLength(300);
  });
});
