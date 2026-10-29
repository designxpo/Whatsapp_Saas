// The two doors: where tools deliver (/api/inbound/<token>) and where a
// business connects them (/api/admin/inbound).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

const h = vi.hoisted(() => ({
  conn: null as null | { row: Record<string, unknown>; secrets: Record<string, string> },
  noted: [] as unknown[],
  ingested: [] as unknown[],
  saved: [] as { tenantId: string; kind: string; config: Record<string, string>; secrets: Record<string, string> }[],
  tenantsAsked: [] as string[],
  role: "admin",
  tenantId: "t1" as string | null,
}));

vi.mock("../inbound/store", () => ({
  findByToken: async (t: string) => (t === "tok-good-0123456789abcdef" ? h.conn : null),
  noteActivity: async (_r: unknown, p: unknown) => { h.noted.push(p); },
  listConnections: async (tenantId: string) => { h.tenantsAsked.push(tenantId); return []; },
  getConnectionWithSecrets: async (tenantId: string) => { h.tenantsAsked.push(tenantId); return null; },
  saveConnection: async (p: { tenantId: string; kind: string; config: Record<string, string>; secrets: Record<string, string> }) => { h.saved.push(p); return { id: "i1", kind: p.kind }; },
  setConnectionPaused: async (tenantId: string) => { h.tenantsAsked.push(tenantId); },
  deleteConnection: async (tenantId: string) => { h.tenantsAsked.push(tenantId); },
  recentEvents: async () => [],
  newInboundToken: () => "new-token-0123456789abcdef",
}));
vi.mock("../inbound/ingest", () => ({
  ingestEvents: async (_r: unknown, events: unknown[]) => { h.ingested.push(...events); return events.map(() => ({ outcome: "processed" })); },
}));
vi.mock("../ratelimit", () => ({ rateLimit: async () => ({ allowed: true, retryAfterSec: 0 }), clientIp: () => "203.0.113.9" }));
vi.mock("../auth", () => ({
  currentUser: async () => ({ email: "a@x.com", role: h.role, tenantId: h.tenantId }),
  currentTenantId: async () => h.tenantId,
  requireRoleAdmin: async () => h.role === "admin",
}));
vi.mock("../team", () => ({ logActivity: () => {} }));
vi.mock("../links", () => ({ trackingOrigin: () => "https://portal.example" }));

// Calendly's API, as the connector reaches it: a 401 means a bad token.
const fetches: string[] = [];
let calendlyStatus = 401;
beforeEach(() => {
  vi.stubGlobal("fetch", async (url: string) => { fetches.push(String(url)); return new Response("{}", { status: calendlyStatus }); });
});
afterEach(() => { vi.unstubAllGlobals(); });

const inbound = await import("../../app/api/inbound/[token]/route");
const admin = await import("../../app/api/admin/inbound/route");

const deliver = (token: string, raw: string, headers: Record<string, string>) =>
  inbound.POST(new Request(`https://portal.example/api/inbound/${token}`, { method: "POST", body: raw, headers }), { params: Promise.resolve({ token }) });
const shopifyConn = (status = "connected") => ({ row: { id: "i1", tenantId: "t1", kind: "shopify", status, config: {} }, secrets: { token: "tok", signingKey: "shpkey" } });
const order = JSON.stringify({ name: "#1", billing_address: { phone: "9876500001" } });
const signedHeaders = (raw: string) => ({ "content-type": "application/json", "x-shopify-topic": "orders/create", "x-shopify-webhook-id": "w1", "x-shopify-hmac-sha256": createHmac("sha256", "shpkey").update(raw).digest("base64") });

beforeEach(() => {
  h.conn = shopifyConn(); h.noted = []; h.ingested = []; h.saved = []; h.tenantsAsked = []; h.role = "admin"; h.tenantId = "t1";
  fetches.length = 0; calendlyStatus = 401;
});

describe("POST /api/inbound/<token>", () => {
  it("is a 404 for a URL that belongs to no connection", async () => {
    expect((await deliver("tok-unknown-0123456789ab", order, signedHeaders(order))).status).toBe(404);
  });

  it("refuses a bad signature, and records why on the connection", async () => {
    const res = await deliver("tok-good-0123456789abcdef", order, { ...signedHeaders(order), "x-shopify-hmac-sha256": "forged" });
    expect(res.status).toBe(401);
    expect(h.noted).toEqual([{ error: expect.stringMatching(/did not match/) }]);
    expect(h.ingested).toEqual([]);
  });

  it("acts on an authentic delivery, and tells the sender counts — never the business's automations", async () => {
    const res = await deliver("tok-good-0123456789abcdef", order, signedHeaders(order));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: 1, processed: 1 });
    expect(h.ingested).toEqual([expect.objectContaining({ eventKey: "shopify.order_created", phone: "919876500001" })]);
  });

  it("refuses an oversized body before reading anything else", async () => {
    const res = await deliver("tok-good-0123456789abcdef", "x".repeat(1_000_001), signedHeaders("x"));
    expect(res.status).toBe(413);
  });

  it("answers 200 while paused, so the tool does not switch its webhook off", async () => {
    h.conn = shopifyConn("paused");
    const res = await deliver("tok-good-0123456789abcdef", order, signedHeaders(order));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paused: true });
    expect(h.ingested).toEqual([]);
  });

  it("answers WooCommerce's unsigned save-time ping, or the merchant cannot save", async () => {
    h.conn = { row: { id: "i2", tenantId: "t1", kind: "woocommerce", status: "connected", config: {} }, secrets: { token: "tok", webhookSecret: "s" } };
    const res = await deliver("tok-good-0123456789abcdef", "webhook_id=7", { "content-type": "application/x-www-form-urlencoded" });
    expect(res.status).toBe(200);
    expect(h.ingested).toEqual([]);
  });
});

describe("/api/admin/inbound", () => {
  const connect = (body: object) => admin.POST(new Request("https://portal.example/api/admin/inbound", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  it("is for admins only", async () => {
    h.role = "member";
    expect((await connect({ kind: "woocommerce" })).status).toBe(403);
    expect((await admin.GET(new Request("https://portal.example/api/admin/inbound"))).status).toBe(403);
  });

  it("needs a signed-in workspace", async () => {
    h.tenantId = null;
    expect((await admin.GET(new Request("https://portal.example/api/admin/inbound"))).status).toBe(401);
    expect((await connect({ kind: "woocommerce" })).status).toBe(401);
  });

  it("reads and changes only the signed-in workspace's connections", async () => {
    h.tenantId = "t2";
    await admin.GET(new Request("https://portal.example/api/admin/inbound"));
    await connect({ kind: "woocommerce", config: {}, secrets: {} });
    await admin.PATCH(new Request("https://portal.example/api/admin/inbound", { method: "PATCH", body: JSON.stringify({ kind: "woocommerce", paused: true }) }));
    await admin.DELETE(new Request("https://portal.example/api/admin/inbound?kind=woocommerce", { method: "DELETE" }));
    expect(new Set(h.tenantsAsked)).toEqual(new Set(["t2"]));
    expect(h.saved.map(s => s.tenantId)).toEqual(["t2"]);
  });

  it("refuses tools that are not connectable yet", async () => {
    for (const kind of ["shiprocket", "cashfree", "leadsquared", "nope"]) expect((await connect({ kind })).status, kind).toBe(400);
  });

  it("generates the secret to paste into the tool, and keeps only declared fields", async () => {
    const res = await connect({ kind: "woocommerce", config: { tags: "VIP", evil: "x" }, secrets: { sneaky: "y" } });
    expect(res.status).toBe(200);
    const saved = h.saved[0];
    expect(saved.config).toEqual({ tags: "VIP" });
    expect(saved.secrets.webhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(saved.secrets).not.toHaveProperty("sneaky");
    expect((await res.json()).webhookUrl).toBe("https://portal.example/api/inbound/new-token-0123456789abcdef");
  });

  it("asks for required credentials", async () => {
    const res = await connect({ kind: "calendly", config: {}, secrets: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Personal access token/);
    expect(fetches).toEqual([]);
  });

  it("connects Shopify before its signing key exists — Shopify shows the key only after a webhook does", async () => {
    expect((await connect({ kind: "shopify", config: {}, secrets: {} })).status).toBe(200);
    expect(h.saved[0].secrets).not.toHaveProperty("signingKey");
  });

  it("saves nothing when the tool rejects the credentials", async () => {
    calendlyStatus = 401;
    const res = await connect({ kind: "calendly", secrets: { apiToken: "bad" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rejected the token/);
    expect(h.saved).toEqual([]);
  });
});
