// CRM sync on the current APIs: Pipedrive persons on v2 (v1 went out of
// support on 1 Aug 2026), and Freshsales matched on mobile number.
//
// Driven through emitEvent, as production does, with the database and the
// secret reader stubbed. Phone numbers and names are synthetic.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], statuses: [] as string[] }));

vi.mock("../tenantdb", () => ({
  tdb: () => ({
    from: () => {
      let wantsSecret = false;
      const q: Record<string, unknown> = {
        select: (cols?: string) => { wantsSecret = cols === "secret"; return q; },
        order: async () => ({ data: h.rows }),
        eq: () => q,
        maybeSingle: async () => ({ data: wantsSecret ? { secret: "the-key" } : h.rows[0] }),
        update: (v: { status: string }) => { h.statuses.push(v.status); return q; },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null }).then(res),
      };
      return q;
    },
  }),
}));
vi.mock("../crypto", () => ({ encryptSecret: (s: string) => s, readSecret: (s: string | null) => s }));
vi.mock("../supabase", () => ({
  db: () => ({ from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, insert: async () => ({ error: null }), then: (r: (v: unknown) => unknown) => Promise.resolve({ count: 0, data: null }).then(r) }; return q; } }),
}));

const { emitEvent, crmPhone, freshsalesBase, freshsalesContact } = await import("../integrations");

type Rule = { match: RegExp; method?: string; status?: number; json?: unknown };
let calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
function serve(rules: Rule[]) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const r = rules.find(x => x.match.test(url) && (!x.method || x.method === method));
    return new Response(JSON.stringify(r?.json ?? {}), { status: r?.status ?? 404 });
  });
}
const row = (kind: string, config: Record<string, unknown> = {}) =>
  ({ id: "i1", kind, name: kind, active: true, config, events: ["contact.created", "conversation.escalated"], status: "connected" });

beforeEach(() => { calls = []; h.rows = []; h.statuses = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("crmPhone", () => {
  it("files only something that is a phone number", () => {
    expect(crmPhone({ phone: "919876500001" })).toBe("+919876500001");
    expect(crmPhone({ phone: "+91 98765 00001" })).toBe("+919876500001");
    expect(crmPhone({ phone: "17841400000000001" })).toBe("");   // an Instagram account id
    expect(crmPhone({ phone: "web:3f2a9c10-1234-4abc-9def-123456789012" })).toBe("");
    expect(crmPhone({})).toBe("");
  });
});

describe("Pipedrive (API v2 persons)", () => {
  it("searches, then creates on v2, with the token in a header — never the URL", async () => {
    h.rows = [row("pipedrive")];
    serve([
      { match: /\/api\/v2\/persons\/search/, status: 200, json: { data: { items: [] } } },
      { match: /\/api\/v2\/persons$/, method: "POST", status: 200, json: { data: { id: 42 } } },
    ]);
    await emitEvent("t1", "contact.created", { phone: "919876500001", name: "Asha Verma" });
    expect(calls.map(c => `${c.method} ${c.url.replace(/\?.*/, "")}`)).toEqual([
      "GET https://api.pipedrive.com/api/v2/persons/search", "POST https://api.pipedrive.com/api/v2/persons",
    ]);
    for (const c of calls) { expect(c.headers["x-api-token"]).toBe("the-key"); expect(c.url).not.toContain("the-key"); }
    expect(calls[1].body).toEqual({ name: "Asha Verma", phones: [{ value: "+919876500001", primary: true, label: "mobile" }] });
  });

  it("does not add someone already there", async () => {
    h.rows = [row("pipedrive")];
    serve([{ match: /persons\/search/, status: 200, json: { data: { items: [{ item: { id: 7, phones: ["+91 98765 00001"] } }] } } }]);
    await emitEvent("t1", "contact.created", { phone: "919876500001", name: "Asha" });
    expect(calls).toHaveLength(1);
  });

  it("never creates after a failed search — that is how a retry would add the person twice", async () => {
    h.rows = [row("pipedrive")];
    serve([{ match: /persons\/search/, status: 503 }]);
    await emitEvent("t1", "contact.created", { phone: "919876500001", name: "Asha" });
    expect(calls).toHaveLength(1);
    expect(h.statuses).toContain("error");
  });

  it("files nothing for an Instagram chat's account id", async () => {
    h.rows = [row("pipedrive")];
    serve([]);
    await emitEvent("t1", "conversation.escalated", { phone: "17841400000000001", name: "@asha" });
    expect(calls).toEqual([]);
  });
});

describe("Freshsales", () => {
  it("accepts only Freshsales addresses — the API key is sent there", () => {
    expect(freshsalesBase("acme.myfreshworks.com")).toBe("https://acme.myfreshworks.com/crm/sales/api");
    expect(freshsalesBase("https://acme.myfreshworks.com/crm/sales")).toBe("https://acme.myfreshworks.com/crm/sales/api");
    expect(freshsalesBase("acme.freshsales.io")).toBe("https://acme.freshsales.io/api");
    for (const bad of ["evil.test", "acme.myfreshworks.com.evil.test", "", "http://10.0.0.1"]) expect(freshsalesBase(bad), bad).toBeNull();
  });

  it("puts a one-word name in last_name, which Freshsales requires", () => {
    expect(freshsalesContact({ phone: "919876500001", name: "Asha" })).toEqual({ last_name: "Asha", mobile_number: "+919876500001" });
  });

  it("upserts on mobile number with the Token header", async () => {
    h.rows = [row("freshsales", { domain: "acme.myfreshworks.com" })];
    serve([{ match: /\/contacts\/upsert/, method: "POST", status: 200, json: { contact: { id: 9 } } }]);
    await emitEvent("t1", "contact.created", { phone: "919876500001", name: "Asha Verma" });
    expect(calls[0].url).toBe("https://acme.myfreshworks.com/crm/sales/api/contacts/upsert");
    expect(calls[0].headers.Authorization).toBe("Token token=the-key");
    expect(calls[0].body).toMatchObject({ unique_identifier: { mobile_number: "+919876500001" }, contact: { first_name: "Asha", last_name: "Verma" } });
  });

  it("where mobile is not unique, creates a new lead once — and never a duplicate on later events", async () => {
    h.rows = [row("freshsales", { domain: "acme.myfreshworks.com" })];
    serve([
      { match: /\/contacts\/upsert/, status: 422, json: { errors: {} } },
      { match: /\/contacts$/, method: "POST", status: 200, json: { contact: { id: 5 } } },
    ]);
    await emitEvent("t1", "contact.created", { phone: "919876500001", name: "Asha" });
    expect(calls.map(c => c.url.split("/api/")[1])).toEqual(["contacts/upsert", "contacts"]);
    calls = [];
    await emitEvent("t1", "conversation.escalated", { phone: "919876500001", name: "Asha" });
    expect(calls.map(c => c.url.split("/api/")[1])).toEqual(["contacts/upsert"]);
  });
});
