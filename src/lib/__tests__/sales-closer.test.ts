import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { memdb, type MemDb } from "./helpers/memdb";

// The AI sales closer: a lead read after new messages (lead-intel.ts), synced
// to the CRM when it changes, and discounts/refunds the AI may only ASK for
// (approvals.ts). What must hold:
//  - the read is the model's, checked: a status's score stays in its band,
//    records beat guesses (paid → Won, opted out → OptOut), customer text
//    can't change the rules;
//  - the CRM hears only changes, and only this workspace's facts count;
//  - the AI never promises a discount or refund; a person decides, the
//    customer is told only what that person sent, and an approved discount on
//    a cart becomes an order at the reduced price.

const T = "00000000-0000-0000-0000-000000000001";
// Each suite mocks a different set; clear them all so none leaks into the next.
const MOCKED = ["../supabase", "../tenantdb", "../ai/chat", "../ai/keys", "../store", "../integrations", "../leadsquared", "../commerce", "../team-send", "../sequences", "../lead-intel"];
function fresh() { vi.resetModules(); for (const mod of MOCKED) vi.doUnmock(mod); }
const OTHER = "00000000-0000-0000-0000-000000000002";
let m: MemDb;

function tdbOf(db: MemDb) {
  return (t: string) => ({
    from: (tb: string) => {
      const b = db.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert;
      b.insert = (p: unknown) => ins(Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  });
}

describe("reading the model's answer", async () => {
  const { parseLeadRead, withFacts, readChanged, transcript } = await import("../lead-intel");

  it("accepts clean JSON, fenced JSON and keeps the score inside its status's band", () => {
    expect(parseLeadRead('{"lead_status":"Hot","intent_score":82,"summary_reason":"Asked for the payment link.","ready_to_pay_alert":true,"action_required":null}'))
      .toEqual({ status: "Hot", score: 82, reason: "Asked for the payment link.", readyToPay: true, action: null });
    expect(parseLeadRead('```json\n{"lead_status":"hot","intent_score":20,"summary_reason":"x","ready_to_pay_alert":"true","action_required":"discount_request"}\n```'))
      .toMatchObject({ status: "Hot", score: 60, readyToPay: true, action: "DISCOUNT_REQUEST" });
    expect(parseLeadRead('{"lead_status":"Cold","intent_score":95}')).toMatchObject({ status: "Cold", score: 29 });
    expect(parseLeadRead('{"lead_status":"Won","intent_score":5,"ready_to_pay_alert":true}')).toMatchObject({ status: "Won", score: 100, readyToPay: false });
  });

  it("refuses an answer it can't trust", () => {
    expect(parseLeadRead("Sure! The lead is hot.")).toBeNull();
    expect(parseLeadRead('{"lead_status":"VIP","intent_score":100}')).toBeNull();
    expect(parseLeadRead('{"lead_status":"Warm","action_required":"GIVE_DISCOUNT"}')).toMatchObject({ action: null });
  });

  it("lets records beat guesses", () => {
    const hot = { status: "Hot" as const, score: 80, reason: "Wants it", readyToPay: true, action: null };
    expect(withFacts(hot, { paidRecently: true, optedOut: false, openRequest: null })).toMatchObject({ status: "Won", score: 100, readyToPay: false });
    expect(withFacts(hot, { paidRecently: false, optedOut: true, openRequest: null })).toMatchObject({ status: "OptOut", score: 1, readyToPay: false });
    expect(withFacts(hot, { paidRecently: false, optedOut: false, openRequest: "refund" })).toMatchObject({ action: "REFUND_REQUEST" });
  });

  it("tells the CRM only about changes", () => {
    const read = { status: "Warm" as const, score: 40, reason: "", readyToPay: false, action: null };
    expect(readChanged({ status: "Warm", readyToPay: false, action: null }, read)).toBe(false);
    expect(readChanged({ status: "Cold", readyToPay: false, action: null }, read)).toBe(true);
    expect(readChanged({ status: "Warm", readyToPay: false, action: null }, { ...read, readyToPay: true })).toBe(true);
    expect(readChanged({ status: "Warm", readyToPay: true, action: null }, read)).toBe(false);   // ready → not ready is not news
  });

  it("builds the transcript the model reads", () => {
    expect(transcript([{ role: "user", body: "[comment] price?" }, { role: "assistant", body: "  ₹999  " }, { role: "user", body: "" }]))
      .toBe("Customer: price?\nBusiness: ₹999");
  });
});

describe("HubSpot gets its own Lead Status values", async () => {
  const { hubspotLeadProps } = await import("../integrations");
  it("maps every status, Won to customer", () => {
    expect(hubspotLeadProps("Cold")).toEqual({ hs_lead_status: "OPEN" });
    expect(hubspotLeadProps("Warm")).toEqual({ hs_lead_status: "IN_PROGRESS" });
    expect(hubspotLeadProps("Hot")).toEqual({ hs_lead_status: "OPEN_DEAL" });
    expect(hubspotLeadProps("OptOut")).toEqual({ hs_lead_status: "UNQUALIFIED" });
    expect(hubspotLeadProps("Won")).toEqual({ lifecyclestage: "customer" });
    expect(hubspotLeadProps("nonsense")).toEqual({});
  });
});

describe("the lead-scoring sweep", () => {
  const NOW = Date.parse("2026-11-03T10:00:00Z");
  let events: { event: string; data: Record<string, unknown> }[];
  let lsqWrites: string[];
  let modelSays: string;
  let settings: Record<string, unknown>;
  let aiCalls: number;
  let aiBusy: boolean;

  async function load() {
    fresh();
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    vi.doMock("../tenantdb", () => ({ tdb: tdbOf(m) }));
    vi.doMock("../ai/chat", () => ({ runChat: async () => { aiCalls++; if (aiBusy) throw new Error("AI_BUSY: 429 RESOURCE_EXHAUSTED"); return { text: modelSays, toolCalls: [] }; } }));
    vi.doMock("../ai/keys", () => ({ resolveTenantAi: async () => ({ provider: "gemini", apiKey: "k", model: "x" }) }));
    vi.doMock("../store", () => ({
      getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in settings ? settings[`${t}|${k}`] : d),
      setTenantSetting: async (t: string, k: string, v: unknown) => { settings[`${t}|${k}`] = v; },
      isOptedOut: async () => false,
    }));
    vi.doMock("../integrations", () => ({ emitEvent: async (_t: string, event: string, data: Record<string, unknown>) => { events.push({ event, data }); } }));
    vi.doMock("../leadsquared", async orig => ({
      plausiblePhone: (await orig<typeof import("../leadsquared")>()).plausiblePhone,
      lsqConfigured: async () => true,
      getLeadIdByPhone: async () => "LEAD1",
      setLeadField: async (_l: string, a: string, v: string) => { lsqWrites.push(`${a}=${v}`); return true; },
    }));
    return import("../lead-intel");
  }

  beforeEach(() => {
    m = memdb();
    events = []; lsqWrites = []; settings = {}; aiCalls = 0; aiBusy = false;
    modelSays = '{"lead_status":"Hot","intent_score":85,"summary_reason":"Asked how to pay for 2 tickets.","ready_to_pay_alert":true,"action_required":null}';
    const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
    m.tables.wa_conversations = [
      { id: "c1", tenant_id: T, phone: "919812345678", name: "Riya", platform: "whatsapp", lead_phone: null, last_inbound_at: at(5), lead_scored_at: null, lead_status: null, ready_to_pay: false, lead_action: null },
      { id: "c2", tenant_id: T, phone: "919800000001", name: "Old", platform: "whatsapp", lead_phone: null, last_inbound_at: at(30), lead_scored_at: at(20), lead_status: "Warm", ready_to_pay: false, lead_action: null },
      { id: "c3", tenant_id: T, phone: "919800000002", name: "Typing", platform: "whatsapp", lead_phone: null, last_inbound_at: new Date(NOW - 10_000).toISOString(), lead_scored_at: null, lead_status: null, ready_to_pay: false, lead_action: null },
    ];
    m.tables.wa_conv_messages = [
      { conversation_id: "c1", tenant_id: T, role: "user", body: "how do I pay for 2 tickets?", created_at: at(6) },
      { conversation_id: "c1", tenant_id: T, role: "assistant", body: "I can send a payment link.", created_at: at(5) },
    ];
    // The same phone paid in ANOTHER workspace — must not make this lead Won.
    m.tables.wa_orders = [{ tenant_id: OTHER, phone: "919812345678", status: "paid", created_at: at(60) }];
  });

  it("reads due chats only, saves the read and sends it to the CRM", async () => {
    settings[`${T}|lead_intel`] = { enabled: true, lsq: { status: "mx_AI_Status", score: "mx_AI_Score", reason: "" } };
    const { drainLeadScoring } = await load();
    expect(await drainLeadScoring(Date.now() + 60_000, 15, NOW)).toEqual({ scored: 1, skipped: 0 });
    const c1 = m.tables.wa_conversations.find(c => c.id === "c1")!;
    expect(c1).toMatchObject({ lead_status: "Hot", intent_score: 85, ready_to_pay: true, lead_reason: "Asked how to pay for 2 tickets." });
    expect(c1.lead_scored_at).toBeTruthy();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "lead.scored", data: { conversationId: "c1", phone: "919812345678", leadStatus: "Hot", intentScore: 85, readyToPay: true } });
    expect(lsqWrites).toEqual(["mx_AI_Status=Hot", "mx_AI_Score=85"]);
    // The changed read is kept as history for Results' "was the AI right?".
    expect(m.tables.wa_lead_reads).toEqual([expect.objectContaining({ tenant_id: T, conversation_id: "c1", phone: "919812345678", status: "Hot", ready_to_pay: true })]);
    // c2 was read after its last message; c3 is still mid-burst.
    expect(m.tables.wa_conversations.find(c => c.id === "c2")!.lead_status).toBe("Warm");
    expect(m.tables.wa_conversations.find(c => c.id === "c3")!.lead_scored_at).toBeNull();
  });

  it("a new message with the same read doesn't ping the CRM again", async () => {
    const { drainLeadScoring } = await load();
    await drainLeadScoring(Date.now() + 60_000, 15, NOW);
    const c1 = m.tables.wa_conversations.find(c => c.id === "c1")!;
    c1.last_inbound_at = new Date(Date.parse(c1.lead_scored_at as string) + 1000).toISOString();
    await drainLeadScoring(Date.now() + 60_000, 15, NOW + 300_000);
    expect(events).toHaveLength(1);
  });

  it("a paid order in THIS workspace makes them Won", async () => {
    m.tables.wa_orders.push({ tenant_id: T, phone: "919812345678", status: "paid", created_at: new Date(NOW - 3600_000).toISOString() });
    const { drainLeadScoring } = await load();
    await drainLeadScoring(Date.now() + 60_000, 15, NOW);
    expect(m.tables.wa_conversations.find(c => c.id === "c1")).toMatchObject({ lead_status: "Won", intent_score: 100, ready_to_pay: false });
  });

  it("pauses a workspace's reads for 30 minutes when its AI is busy, so the rate limit can recover", async () => {
    m.tables.wa_conversations.find(c => c.id === "c2")!.lead_scored_at = null;   // two chats due
    aiBusy = true;
    const { drainLeadScoring } = await load();
    expect(await drainLeadScoring(Date.now() + 60_000, 15, NOW)).toEqual({ scored: 0, skipped: 2 });
    expect(aiCalls).toBe(1);   // stopped after the first busy answer
    expect(settings[`${T}|lead_intel_backoff_until`]).toBe(new Date(NOW + 30 * 60_000).toISOString());
    aiBusy = false;
    await drainLeadScoring(Date.now() + 60_000, 15, NOW + 10 * 60_000);
    expect(aiCalls).toBe(1);   // still paused
    expect((await drainLeadScoring(Date.now() + 60_000, 15, NOW + 31 * 60_000)).scored).toBe(1);   // resumed
    expect(m.tables.wa_conversations.find(c => c.id === "c1")!.lead_status).toBe("Hot");
  });

  it("skips a workspace that switched it off, and moves past an unreadable answer", async () => {
    settings[`${T}|lead_intel`] = { enabled: false };
    let mod = await load();
    expect(await mod.drainLeadScoring(Date.now() + 60_000, 15, NOW)).toEqual({ scored: 0, skipped: 1 });
    settings[`${T}|lead_intel`] = { enabled: true };
    modelSays = "I think they're keen!";
    mod = await load();
    expect(await mod.drainLeadScoring(Date.now() + 60_000, 15, NOW)).toEqual({ scored: 0, skipped: 1 });
    const c1 = m.tables.wa_conversations.find(c => c.id === "c1")!;
    expect(c1.lead_status).toBeNull();
    expect(c1.lead_scored_at).toBeTruthy();   // not asked again every tick
  });
});

describe("approvals", () => {
  let sent: string[];
  let windowOpen: boolean;
  let checkouts: { phone: string; discountPercent?: number }[];
  let settings: Record<string, unknown>;

  async function load() {
    fresh();
    vi.doMock("../tenantdb", () => ({ tdb: tdbOf(m) }));
    vi.doMock("../store", () => ({
      getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in settings ? settings[`${t}|${k}`] : d),
      setTenantSetting: async (t: string, k: string, v: unknown) => { settings[`${t}|${k}`] = v; },
      getConversation: async (id: string, t: string) => {
        const c = m.tables.wa_conversations.find(x => x.id === id && x.tenant_id === t);
        return c ? { id: c.id, phone: c.phone, platform: c.platform, tenantId: c.tenant_id, lastInboundAt: c.last_inbound_at, channelId: null } : null;
      },
    }));
    vi.doMock("../commerce", () => ({
      getOpenCart: async () => ({ id: "cart1", items: [{ productId: "p", name: "Course", qty: 1, priceCents: 1_000_000 }] }),
      checkoutCart: async (p: { phone: string; discountPercent?: number }) => { checkouts.push(p); return { orderId: "11111111-1111-4111-8111-111111111111", totalCents: 900_000, paymentUrl: "https://rzp.io/l/abc" }; },
    }));
    vi.doMock("../team-send", () => ({
      canSendFreeText: () => windowOpen,
      sendTeamText: async (_c: unknown, text: string) => { sent.push(text); return { ok: true }; },
    }));
    return import("../approvals");
  }

  beforeEach(() => {
    m = memdb();
    sent = []; windowOpen = true; checkouts = []; settings = {};
    m.tables.wa_conversations = [{ id: "c1", tenant_id: T, phone: "919812345678", platform: "whatsapp", last_inbound_at: new Date().toISOString(), lead_action: null }];
    m.tables.wa_approval_requests = [];
  });

  it("does nothing while the workspace hasn't allowed it", async () => {
    const a = await load();
    const r = await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "discount", percent: 10, reason: "price" });
    expect(r.status).toMatch(/Don't promise/);
    expect(m.tables.wa_approval_requests).toHaveLength(0);
  });

  it("files one request per chat, flags an ask over the limit, and never says yes", async () => {
    settings[`${T}|approval_policy`] = { discounts: { enabled: true, maxPercent: 10 }, refunds: { enabled: true } };
    const a = await load();
    const first = await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "discount", percent: 8, reason: "Wants a deal" });
    expect(first.status).toMatch(/Do NOT promise/);
    expect(first.status).not.toMatch(/10/);   // the limit is never told to the model
    await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "discount", percent: 25, reason: "Now wants more" });
    expect(m.tables.wa_approval_requests).toHaveLength(1);
    expect(m.tables.wa_approval_requests[0]).toMatchObject({ tenant_id: T, conversation_id: "c1", kind: "discount", percent: 25, over_limit: true, status: "pending" });
    expect(m.tables.wa_conversations[0].lead_action).toBe("DISCOUNT_REQUEST");
  });

  it("approving a discount places the order at the reduced price and sends the link", async () => {
    settings[`${T}|approval_policy`] = { discounts: { enabled: true, maxPercent: 10 }, refunds: { enabled: false } };
    const a = await load();
    const { requestId } = await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "discount", percent: 10, reason: "x" });
    const r = await a.decideApproval(T, requestId!, "approve", "", "Priyesh");
    expect(r.error).toBeUndefined();
    expect(checkouts).toEqual([{ phone: "919812345678", discountPercent: 10 }]);
    expect(sent[0]).toMatch(/10% off/);
    expect(sent[0]).toContain("https://rzp.io/l/abc");
    expect(m.tables.wa_approval_requests[0]).toMatchObject({ status: "approved", decided_by: "Priyesh", result_order_id: "11111111-1111-4111-8111-111111111111" });
    expect(m.tables.wa_conversations[0].lead_action).toBeNull();
    // A second click finds it already decided and sends nothing more.
    expect((await a.decideApproval(T, requestId!, "reject", "", "Someone")).error).toMatch(/already approved/);
    expect(sent).toHaveLength(1);
  });

  it("won't decide what the customer can't be told; cancel closes without a message", async () => {
    settings[`${T}|approval_policy`] = { discounts: { enabled: false, maxPercent: 10 }, refunds: { enabled: true } };
    const a = await load();
    const { requestId } = await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "refund", reason: "Damaged" });
    windowOpen = false;
    expect((await a.decideApproval(T, requestId!, "reject", "No", "P")).error).toMatch(/24-hour window/);
    expect(m.tables.wa_approval_requests[0].status).toBe("pending");
    expect((await a.decideApproval(T, requestId!, "cancel", undefined, "P")).request?.status).toBe("cancelled");
    expect(sent).toEqual([]);
  });

  it("another workspace can't see or decide this one's requests", async () => {
    settings[`${T}|approval_policy`] = { discounts: { enabled: true, maxPercent: 10 }, refunds: { enabled: false } };
    const a = await load();
    const { requestId } = await a.requestApproval({ tenantId: T, phone: "919812345678", platform: "whatsapp", kind: "discount", percent: 5, reason: "x" });
    expect((await a.listApprovals(OTHER)).requests).toEqual([]);
    expect((await a.decideApproval(OTHER, requestId!, "approve", "yes", "intruder")).error).toMatch(/isn't in this workspace/);
    expect(sent).toEqual([]);
  });
});

describe("checkout at an approved discount", () => {
  it("charges the reduced total and says so on the pay link", async () => {
    fresh();
    m = memdb();
    m.tables.wa_carts = [{ id: "cart1", tenant_id: T, phone: "919812345678", status: "open", items: [{ productId: "p", name: "A", qty: 2, priceCents: 49_950 }] }];
    const links: { amountCents: number; description: string }[] = [];
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    vi.doMock("../sequences", () => ({ getSequenceByTrigger: async () => null, enroll: async () => undefined }));
    vi.doMock("../integrations", () => ({ emitEvent: async () => undefined, createPaymentLink: async (_t: string, p: { amountCents: number; description: string }) => { links.push(p); return { url: "https://pay", id: "plink_1" }; } }));
    vi.doMock("../lead-intel", () => ({ syncToCrm: async () => undefined }));
    const { checkoutCart } = await import("../commerce");
    const r = await checkoutCart({ phone: "919812345678", discountPercent: 15 }, T);
    expect(r?.totalCents).toBe(84_915);   // 99,900 less 15%, rounded
    expect(links[0]).toMatchObject({ amountCents: 84_915 });
    expect(links[0].description).toMatch(/15% off/);
    expect(m.tables.wa_orders[0]).toMatchObject({ total_cents: 84_915 });
  });
});

describe("alerts for chats a person should act on", () => {
  it("lists ready-to-pay leads and pending approvals, within the person's channels", async () => {
    fresh();
    m = memdb();
    const now = Date.now();
    m.tables.wa_conversations = [
      { id: "a", tenant_id: T, name: "Ready", phone: "1", platform: "whatsapp", channel_id: "ch1", last_message: "pay link?", ready_to_pay: true, lead_scored_at: new Date(now - 60_000).toISOString() },
      { id: "b", tenant_id: T, name: "Other team", phone: "2", platform: "whatsapp", channel_id: "ch2", ready_to_pay: true, lead_scored_at: new Date(now - 60_000).toISOString() },
      { id: "c", tenant_id: T, name: "Discount", phone: "3", platform: "instagram", channel_id: "ch1", ready_to_pay: false },
      { id: "d", tenant_id: OTHER, name: "Not ours", phone: "4", platform: "whatsapp", channel_id: "ch1", ready_to_pay: true, lead_scored_at: new Date(now - 60_000).toISOString() },
    ];
    m.tables.wa_approval_requests = [{ tenant_id: T, conversation_id: "c", status: "pending", created_at: new Date(now - 30_000).toISOString() }];
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    const { chatsNeedingAction } = await import("../store");
    const out = await chatsNeedingAction({ tenantId: T, channelIds: ["ch1"], now });
    expect(out.map(c => [c.id, c.reason])).toEqual([["c", "approval"], ["a", "ready_to_pay"]]);
  });
});

describe("the AI can ask, never in practice (source guard)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../llm.ts"), "utf8");
  it("offers the approval tools only when allowed, and never in a practice run", () => {
    expect(src).toContain("const approvalPolicy = !opts.practice && phone ? await getApprovalPolicy(tenantId)");
    expect(src).toMatch(/approvalPolicy\?\.discounts\.enabled \? \[DISCOUNT_TOOL\]/);
    expect(src).toMatch(/approvalPolicy\?\.refunds\.enabled \? \[REFUND_TOOL\]/);
    expect(src).toMatch(/You can NEVER give, promise or confirm a discount yourself/);
  });
});
