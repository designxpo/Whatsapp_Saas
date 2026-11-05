// Review requests (lib/review-booster.ts) end to end: settings, triggers (paid
// orders, events from connected tools, by hand), the checks made at send time
// (plan, opt-out, frequency, quiet hours, WhatsApp's 24-hour window, template
// consent), retries without duplicates, reminders, the tracked link and the QR.
// WhatsApp, Google and the database are isolated; nothing real is sent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/memdb").MemDb,
  tenant: "t1", admin: true, allowed: true, canSend: true,
  sent: [] as { phone: string; body: string }[],
  templated: [] as { phone: string; name: string; body: string[]; buttons?: (string | null)[] }[],
  templates: [] as { name: string; status: string; language: string; category: string; components: { type: string; text?: string; buttons?: { type: string; url?: string }[] }[] }[],
  failSends: 0,
  locations: [{ id: "loc1", name: "Indiranagar" }] as { id: string; name: string }[],
}));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../auth", () => ({
  DEFAULT_TENANT_ID: "owner", currentTenantId: async () => h.tenant, requireRoleAdmin: async () => h.admin,
  currentUser: async () => ({ email: "a@b.in", name: "A", role: "admin", tenantId: h.tenant }), requireAdmin: async () => true,
}));
vi.mock("../entitlements", () => ({ checkFeature: async () => ({ ok: h.allowed }) }));
vi.mock("../feature-guard", () => ({ guardFeature: async () => (h.allowed ? null : Response.json({ error: "not in plan" }, { status: 402 })), accountCanSend: async () => h.canSend }));
vi.mock("../googlereviews", () => ({ locationReviewUrl: async () => ({ url: "https://g.page/r/FromGoogle/review" }) }));
vi.mock("../channels", () => ({
  listChannels: async (t?: string) => [
    { id: "wa1", tenantId: t, kind: "whatsapp", active: true, isDefault: true, token: "EAA", phoneId: "p1" },
    ...h.locations.map(l => ({ ...l, tenantId: t, kind: "google_reviews", active: true, token: "refresh", googleAccountId: "accounts/1", googleLocationId: `locations/${l.id}` })),
  ],
  isLiveChannel: (c: { active: boolean; token: string }) => c.active && !!c.token,
  getChannel: async (id: string) => (h.locations.some(l => l.id === id) ? { id, kind: "google_reviews", name: "Indiranagar" } : null),
}));
vi.mock("../whatsapp", async orig => {
  const real = await orig<typeof import("../whatsapp")>();
  return {
    ...real,
    sendText: vi.fn(async (phone: string, body: string) => {
      if (h.failSends > 0) { h.failSends--; return { error: "Meta is having trouble (131000)" }; }
      h.sent.push({ phone, body }); return { id: `wamid.${h.sent.length}` };
    }),
    sendTemplateSingle: vi.fn(async (phone: string, name: string, _l: string, body: string[] = [], _c?: unknown, _i?: string, buttons?: (string | null)[]) => { h.templated.push({ phone, name, body, buttons }); return { id: `wamid.t${h.templated.length}` }; }),
    fetchTemplates: vi.fn(async () => h.templates),
  };
});

import { memdb } from "./helpers/memdb";
import {
  saveRequestConfig, getRequestConfig, drainReviewRequests, sendNow, queueFromEvent, normalizeConfig,
  inQuietHours, afterQuietHours, templateValues, openReviewLink,
} from "../review-booster";
import { processEvent } from "../apirules";
import { GET as settingsGet, POST as settingsPost } from "../../app/api/admin/review-booster/route";
import { GET as qr } from "../../app/api/admin/review-booster/qr/route";
import { GET as openLink } from "../../app/r/rv/[token]/route";

// 12:00 noon in India — outside the default quiet hours (9 pm – 9 am).
const NOON = Date.parse("2026-11-05T06:30:00Z");
const ago = (min: number, from = NOON) => new Date(from - min * 60_000).toISOString();
const PHONE = "919812345678";
const rows = () => h.db.tables.wa_review_requests ?? [];
const chat = (phone = PHONE, minutesAgo = 60) => ({ id: `c-${phone}`, tenant_id: "t1", phone, platform: "whatsapp", last_inbound_at: ago(minutesAgo) });
const on = (extra: Record<string, unknown> = {}) => saveRequestConfig("t1", { enabled: true, reviewUrl: "https://g.page/r/Shop/review", delayMinutes: 30, ...extra });
const req = (url: string, body?: unknown) => new NextRequest(`https://app.thetalko.in${url}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const utility = { name: "review_ask", status: "APPROVED", language: "en", category: "UTILITY", components: [{ type: "BODY", text: "Thanks for visiting! Review us: {{1}}" }] };

beforeEach(() => {
  h.db = memdb({ wa_review_requests: [["token"], ["tenant_id", "order_id"], ["tenant_id", "source", "source_ref"]] });
  h.tenant = "t1"; h.admin = true; h.allowed = true; h.canSend = true;
  h.sent = []; h.templated = []; h.templates = []; h.failSends = 0;
  h.locations = [{ id: "loc1", name: "Indiranagar" }];
  process.env.BUSINESS_TZ = "Asia/Kolkata";
});

describe("review request settings", () => {
  it("reads the older review-booster settings (hours) as minutes", () => {
    const c = normalizeConfig({ enabled: true, reviewUrl: "https://g.page/r/x/review", message: "Hi", delayHours: 2 });
    expect(c).toMatchObject({ enabled: true, delayMinutes: 120, triggers: { paidOrder: true, events: [] }, frequencyDays: 30 });
  });

  it("won't switch on without a review link or a trigger, or with a location from elsewhere", async () => {
    expect((await saveRequestConfig("t1", { enabled: true })).error).toMatch(/review link/);
    expect((await saveRequestConfig("t1", { enabled: true, reviewUrl: "https://g.page/r/x/review", triggers: { paidOrder: false, events: [] } })).error).toMatch(/Choose when to ask/);
    expect((await saveRequestConfig("t1", { locationId: "someone-elses" })).error).toMatch(/isn't connected/);
    expect((await saveRequestConfig("t1", { reviewUrl: "https://evil.example/review" })).error).toMatch(/Google review link/);
    // A location's own link (from its sync) is enough.
    h.db.tables.wa_settings = [{ tenant_id: "t1", key: "google_reviews_sync:loc1", value: { ok: true, at: ago(5), reviewUri: "https://search.google.com/local/writereview?placeid=P" } }];
    expect((await saveRequestConfig("t1", { enabled: true, locationId: "loc1" })).config).toMatchObject({ enabled: true, locationId: "loc1" });
  });

  it("is only for plans that include Google Reviews", async () => {
    h.allowed = false;
    expect((await settingsGet()).status).toBe(402);
    expect((await settingsPost(req("/api/admin/review-booster", { action: "send", phone: PHONE }))).status).toBe(402);
    h.allowed = true; h.admin = false;
    expect((await settingsGet()).status).toBe(403);
  });
});

describe("sending review requests", () => {
  it("paid order → waits for the delay → sent once with a tracked link → opened → counted", async () => {
    await on();
    h.db.tables.wa_orders = [{ id: "o1", tenant_id: "t1", phone: PHONE, status: "paid", paid_at: ago(10) }];
    h.db.tables.wa_conversations = [chat()];
    await drainReviewRequests(NOON);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "scheduled", source: "order", source_ref: "order:o1" });
    expect(h.sent).toHaveLength(0);                       // 10 minutes in, the delay is 30
    await drainReviewRequests(NOON + 25 * 60_000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].body).toContain(`/r/rv/${rows()[0].token}`);
    expect(h.sent[0].body).toContain("Something not right? Just reply here");
    await drainReviewRequests(NOON + 60 * 60_000);
    expect(h.sent).toHaveLength(1);                        // once per order
    const res = await openLink(new Request("https://app.thetalko.in/r/rv/x"), { params: Promise.resolve({ token: rows()[0].token as string }) });
    expect(res.headers.get("location")).toBe("https://g.page/r/Shop/review");
    expect(rows()[0].clicks).toBe(1);
    expect(h.db.tables.wa_conv_messages?.[0]).toMatchObject({ conversation_id: `c-${PHONE}`, source: "bot" });
  });

  it("a completed-service event from a connected tool queues one request, with the outlet's own link", async () => {
    await on({ triggers: { paidOrder: false, events: ["mezmitra.bill.paid"] } });
    const payload = { bill_id: "b42", review_url: "https://g.page/r/Outlet/review", outlet_name: "Koramangala" };
    await processEvent({ event: "mezmitra.bill.paid", phone: "9812345678", name: "Asha", payload }, "t1");
    await processEvent({ event: "mezmitra.bill.paid", phone: "9812345678", name: "Asha", payload }, "t1");   // a retried webhook
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ source: "event", source_ref: "mezmitra.bill.paid:b42", review_url: "https://g.page/r/Outlet/review", phone: PHONE, name: "Asha" });
    expect(await queueFromEvent("t1", "shopify.order_paid", PHONE, "X", { order_id: "s1" })).toBe("ignored");   // not chosen
  });

  it("outside the 24-hour window: skipped without a template; a utility template carries the link", async () => {
    await on();
    h.db.tables.wa_conversations = [chat(PHONE, 3 * 24 * 60)];
    expect((await sendNow("t1", PHONE, null, NOON)).detail).toMatch(/24-hour window and no approved template/);
    h.templates = [utility];
    await saveRequestConfig("t1", { template: { name: "review_ask", language: "en" } });
    expect((await sendNow("t1", PHONE, null, NOON + 1)).status).toBe("sent");
    expect(h.templated[0]).toMatchObject({ phone: PHONE, name: "review_ask" });
    expect(h.templated[0].body[0]).toMatch(/\/r\/rv\/[a-z0-9]{12}$/);
  });

  it("a marketing template only reaches customers who opted in", async () => {
    await on({ frequencyDays: 0, template: { name: "review_promo", language: "en" } });
    h.templates = [{ ...utility, name: "review_promo", category: "MARKETING" }];
    expect((await sendNow("t1", PHONE, null, NOON)).detail).toMatch(/hasn't opted in/);
    h.db.tables.contacts = [{ id: "k1", tenant_id: "t1", phone: PHONE, opted_in: true }];
    expect((await sendNow("t1", PHONE, null, NOON + 1)).status).toBe("sent");
  });

  it("respects opt-outs and the once-every-N-days limit", async () => {
    await on();
    h.db.tables.wa_conversations = [chat(), chat("919800000001")];
    h.db.tables.wa_optouts = [{ tenant_id: "t1", phone: "9812345678" }];
    expect((await sendNow("t1", PHONE, null, NOON)).detail).toMatch(/opted out/);
    expect((await sendNow("t1", "919800000001", null, NOON)).status).toBe("sent");
    expect((await sendNow("t1", "919800000001", null, NOON + 60_000)).detail).toMatch(/Already asked in the last 30 days/);
  });

  it("waits out quiet hours instead of messaging at night", async () => {
    await on();
    const night = Date.parse("2026-11-05T17:00:00Z");   // 10:30 pm in India
    h.db.tables.wa_orders = [{ id: "o2", tenant_id: "t1", phone: PHONE, status: "paid", paid_at: ago(60, night) }];
    h.db.tables.wa_conversations = [chat(PHONE, 1)];
    await drainReviewRequests(night);
    expect(h.sent).toHaveLength(0);
    expect(rows()[0]).toMatchObject({ status: "scheduled", send_after: "2026-11-06T03:30:00.000Z" });   // 9 am India
    expect(inQuietHours(22, { start: 21, end: 9 })).toBe(true);
    expect(inQuietHours(12, { start: 21, end: 9 })).toBe(false);
    expect(afterQuietHours(new Date(NOON), { start: 21, end: 9 }).getTime()).toBe(NOON);
  });

  it("retries a failed send twice, then records it as failed — never twice at once", async () => {
    await on();
    h.db.tables.wa_orders = [{ id: "o3", tenant_id: "t1", phone: PHONE, status: "paid", paid_at: ago(60) }];
    h.db.tables.wa_conversations = [chat()];
    h.failSends = 5;
    await drainReviewRequests(NOON);
    expect(rows()[0]).toMatchObject({ status: "scheduled", attempts: 1 });
    await drainReviewRequests(NOON + 11 * 60_000);
    await drainReviewRequests(NOON + 22 * 60_000);
    expect(rows()[0]).toMatchObject({ status: "failed", detail: expect.stringMatching(/131000/) });
    // Two overlapping runs over a fresh request send it once.
    h.failSends = 0;
    h.db.tables.wa_orders.push({ id: "o4", tenant_id: "t1", phone: "919800000002", status: "paid", paid_at: ago(60) });
    h.db.tables.wa_conversations.push(chat("919800000002"));
    await Promise.all([drainReviewRequests(NOON + 30 * 60_000), drainReviewRequests(NOON + 30 * 60_000)]);
    expect(h.sent.filter(m => m.phone === "919800000002")).toHaveLength(1);
  });

  it("one reminder if the link wasn't opened, only inside the window, never twice", async () => {
    await on({ reminder: { enabled: true, afterHours: 4 } });
    h.db.tables.wa_conversations = [chat(PHONE, 5)];
    await sendNow("t1", PHONE, null, NOON);
    await drainReviewRequests(NOON + 5 * 3_600_000);
    await drainReviewRequests(NOON + 6 * 3_600_000);
    expect(h.sent.filter(m => /gentle reminder/.test(m.body))).toHaveLength(1);
  });

  it("stops when the plan ends, when requests are switched off, or the location is disconnected", async () => {
    await on({ locationId: "loc1" });
    h.db.tables.wa_orders = [{ id: "o5", tenant_id: "t1", phone: PHONE, status: "paid", paid_at: ago(10) }];
    await drainReviewRequests(NOON);
    h.locations = [];
    await drainReviewRequests(NOON + 60 * 60_000);
    expect(rows()[0]).toMatchObject({ status: "cancelled", detail: expect.stringMatching(/disconnected/) });
    h.locations = [{ id: "loc1", name: "Indiranagar" }];
    h.db.tables.wa_orders.push({ id: "o6", tenant_id: "t1", phone: "919800000003", status: "paid", paid_at: ago(10) });
    await drainReviewRequests(NOON);
    await saveRequestConfig("t1", { enabled: false });
    expect(rows().find(r => r.order_id === "o6")).toMatchObject({ status: "cancelled", detail: "Review requests were switched off." });
    h.allowed = false;
    expect(await queueFromEvent("t1", "mezmitra.bill.paid", PHONE, "X", {})).toBe("ignored");
    expect(h.sent).toHaveLength(0);
  });

  it("keeps each workspace's requests to itself", async () => {
    await on();
    await sendNow("t1", PHONE, null, NOON);
    expect(rows().every(r => r.tenant_id === "t1")).toBe(true);
    h.tenant = "t2";
    const body = await (await settingsGet()).json();
    expect(body.stats.sent).toBe(0);
    expect(body.config.enabled).toBe(false);
  });
});

describe("review links and QR codes", () => {
  it("a template needs exactly one place for the link", () => {
    expect(templateValues(utility, "L", "T")).toEqual({ body: ["L"], buttons: [] });
    expect(templateValues({ components: [{ type: "BODY", text: "Hi" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://app.thetalko.in/r/rv/{{1}}" }] }] }, "L", "T")).toEqual({ body: [], buttons: ["T"] });
    expect("error" in templateValues({ components: [{ type: "BODY", text: "Hi {{1}}, review {{2}}" }] }, "L", "T")).toBe(true);
    expect("error" in templateValues({ components: [{ type: "BODY", text: "Hi" }] }, "L", "T")).toBe(true);
  });

  it("a QR code PNG for a location's review page, admins only", async () => {
    expect((await qr(new Request("https://app.thetalko.in/api/admin/review-booster/qr?location=loc1"))).status).toBe(404);   // no link yet
    h.db.tables.wa_settings = [{ tenant_id: "t1", key: "google_reviews_sync:loc1", value: { ok: true, at: ago(5), reviewUri: "https://search.google.com/local/writereview?placeid=P" } }];
    const r = await qr(new Request("https://app.thetalko.in/api/admin/review-booster/qr?location=loc1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(500);
    h.admin = false;
    expect((await qr(new Request("https://app.thetalko.in/api/admin/review-booster/qr?location=loc1"))).status).toBe(403);
  });

  it("an unknown tracked link goes nowhere", async () => {
    expect(await openReviewLink("zzzzzzzzzzzz")).toBeNull();
    expect(await openReviewLink("../etc")).toBeNull();
    expect((await getRequestConfig("t1")).enabled).toBe(false);
  });
});
