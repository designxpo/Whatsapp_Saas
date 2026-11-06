// Phase 2 "automation visibility": what runs for one customer and what happens
// next, why journeys stopped, stopping each kind safely, and the AI Hub routing
// preview agreeing with the live routing rule. Synthetic names and numbers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memdb, type MemDb } from "./helpers/memdb";

const h = vi.hoisted(() => ({
  m: null as unknown as MemDb,
  settings: {} as Record<string, unknown>,
  cfg: { enabled: true, delayMinutes: 60, maxAttempts: 2 },
  flow: null as null | { flowId: string; currentNode: string },
  ended: [] as string[],
  optedOut: false,
  embed: null as null | number[] | "fail",
  iso: false,
}));

vi.mock("../supabase", () => ({ db: () => h.m.client }));
vi.mock("../tenantdb", () => ({
  tdb: (t: string) => ({
    from: (tb: string) => {
      const b = h.m.client.from(tb) as Record<string, (...a: unknown[]) => unknown>;
      const ins = b.insert;
      b.insert = (p: unknown) => ins(Array.isArray(p) ? p.map(x => ({ ...(x as object), tenant_id: t })) : { ...(p as object), tenant_id: t });
      return (b.eq as (c: string, v: string) => unknown)("tenant_id", t);
    },
  }),
}));
vi.mock("../store", async orig => ({
  ...(await orig<typeof import("../store")>()),
  getTenantSetting: async (t: string, k: string, d: unknown) => (`${t}|${k}` in h.settings ? h.settings[`${t}|${k}`] : d),
  setTenantSetting: async (t: string, k: string, v: unknown) => { h.settings[`${t}|${k}`] = v; },
  isOptedOutStrict: async () => h.optedOut,
}));
vi.mock("../followups", () => ({ followupConfig: async () => h.cfg, FOLLOWUP_SAFE_WINDOW_MS: 23.5 * 3_600_000 }));
vi.mock("../flowengine", () => ({ currentFlowSession: async () => h.flow, endSession: async (k: string) => { h.ended.push(k); h.flow = null; } }));
vi.mock("../kb", () => ({ embedQuery: async () => { if (h.embed === "fail" || !h.embed) throw new Error("AI_BUSY"); return h.embed; } }));
vi.mock("../isolation", () => ({ getIsolation: async () => ({ mode: h.iso ? "on" : "auto", active: h.iso }) }));

import { customerAutomations, explainFollowup, stopAutomation } from "../automations";
import { stopAllEnrollments, noteStopReason } from "../sequences";
import { decideRoute, type AgentScore } from "../aihub";
import { explainRoute, previewRoute } from "../route-preview";
import type { WorkViewer } from "../tasks";

const T = "10000000-0000-0000-0000-000000000001";
const O = "20000000-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-11-06T06:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ahead = (min: number) => new Date(NOW + min * 60_000).toISOString();

const admin: WorkViewer = { user: { email: "asha@biz.test", name: "Asha", role: "admin", tenantId: T }, tenantId: T, allowed: null, canManage: true };
const ben: WorkViewer = { user: { email: "ben@biz.test", name: "Ben", role: "member", team: "sales", tenantId: T }, tenantId: T, allowed: ["ch2"], canManage: false };

const chatRow = (x: Record<string, unknown> = {}) => ({
  id: "c1", tenant_id: T, phone: "919876500001", platform: "whatsapp", channel_id: "ch1", status: "active", bot_enabled: true,
  last_inbound_at: ago(120), last_outbound_at: ago(90), followup_count: 0, last_followup_at: null, bot_resumed_at: null, ...x,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  h.m = memdb(); h.settings = {}; h.cfg = { enabled: true, delayMinutes: 60, maxAttempts: 2 }; h.flow = null; h.ended = []; h.optedOut = false; h.embed = null; h.iso = false;
  const t = h.m.tables;
  t.wa_conversations = [chatRow(), chatRow({ id: "cx", tenant_id: O })];
  t.wa_sequences = [{ id: "s1", tenant_id: T, name: "New lead nurture", active: true }, { id: "s2", tenant_id: T, name: "Old promo", active: true }];
  t.wa_sequence_steps = [0, 1, 2].map(i => ({ sequence_id: "s1", tenant_id: T, step_index: i }));
  t.wa_sequence_enrollments = [
    { id: "e1", tenant_id: T, sequence_id: "s1", phone: "919876500001", status: "active", current_step: 1, next_run_at: ahead(45), last_error: null, stop_reason: null, created_at: ago(3000), updated_at: ago(60) },
    { id: "e2", tenant_id: T, sequence_id: "s2", phone: "919876500001", status: "stopped", current_step: 0, next_run_at: null, last_error: null, stop_reason: "The customer replied", stopped_at: ago(500), created_at: ago(9000), updated_at: ago(500) },
    { id: "e3", tenant_id: O, sequence_id: "s1", phone: "919876500001", status: "active", current_step: 0, next_run_at: ahead(5), created_at: ago(10), updated_at: ago(10) },
    { id: "e4", tenant_id: T, sequence_id: "s1", phone: "919876500099", status: "active", current_step: 0, next_run_at: ahead(5), created_at: ago(10), updated_at: ago(10) },
  ];
  t.wa_review_requests = [{ id: "rr1", tenant_id: T, phone: "919876500001", status: "scheduled", send_after: ahead(20), source: "order" }];
  t.wa_orders = [{ id: "ord12345-x", tenant_id: T, phone: "919876500001", status: "pending", unpaid_reminded_at: null, payment_url: "https://rzp.io/x", created_at: ago(30) }];
});
afterEach(() => vi.useRealTimers());

describe("the AI follow-up, explained the way the job decides it", () => {
  const ctx = { inFlow: false, onJourney: false, optedOut: false, now: NOW };
  const c = chatRow() as Parameters<typeof explainFollowup>[0];
  it("says when the next follow-up goes out", () => {
    const a = explainFollowup(c, h.cfg, ctx);
    expect(a).toMatchObject({ state: "running", canStop: true, next: { at: ahead(-30) } });   // 60 min after our last message
    expect(a.why).toMatch(/Follow-up 1 of 2/);
  });
  it("explains every reason it won't", () => {
    expect(explainFollowup(c, { ...h.cfg, enabled: false }, ctx).why).toMatch(/switched off/);
    expect(explainFollowup({ ...c, bot_enabled: false }, h.cfg, ctx).why).toMatch(/person has taken over/);
    expect(explainFollowup({ ...c, followup_count: 2 }, h.cfg, ctx)).toMatchObject({ state: "finished", canStop: false });
    expect(explainFollowup({ ...c, followup_count: 3 }, h.cfg, ctx).why).toMatch(/until the customer writes again/);
    expect(explainFollowup({ ...c, last_inbound_at: ago(10) }, h.cfg, ctx).why).toMatch(/customer wrote last/);
    expect(explainFollowup({ ...c, last_inbound_at: ago(25 * 60), last_outbound_at: ago(24 * 60) }, h.cfg, ctx).why).toMatch(/24-hour window/);
    expect(explainFollowup(c, h.cfg, { ...ctx, inFlow: true }).why).toMatch(/flow is running/);
    expect(explainFollowup(c, h.cfg, { ...ctx, onJourney: true }).why).toMatch(/journey is running/);
    expect(explainFollowup(c, h.cfg, { ...ctx, optedOut: true }).state).toBe("off");
    // Due after the window closes: none will be sent, and it says so.
    // Window closes in 10 minutes, next follow-up due in 55: none will be sent.
    expect(explainFollowup({ ...c, last_inbound_at: ago(23 * 60 + 20), last_outbound_at: ago(5) }, h.cfg, ctx).why).toMatch(/would fall outside/);
  });
});

describe("what runs for one customer", () => {
  it("lists the journey's next step, why another stopped, the flow, the AI, a review request and a payment reminder", async () => {
    h.flow = { flowId: "f1", currentNode: "ask_city" };
    h.m.tables.wa_flows = [{ id: "f1", tenant_id: T, name: "Table booking" }];
    h.settings[`${T}|work_settings`] = { unpaidReminder: { enabled: true, afterMinutes: 60 } };
    const r = (await customerAutomations(admin, "c1", NOW))!;
    const by = (k: string) => r.automations.find(a => a.key === k)!;
    expect(by("journey:e1")).toMatchObject({ title: "Journey: New lead nurture", state: "running", canStop: true, next: { at: ahead(45), what: "Step 2 of 3 is sent" } });
    expect(by("journey:e2")).toMatchObject({ state: "stopped", why: "The customer replied", canStop: false });
    expect(by("flow:c1")).toMatchObject({ title: "Chatbot flow: Table booking", canStop: true });
    expect(by("ai_followup:c1").why).toMatch(/flow is running/);       // a flow owns the chat
    expect(by("review_request:rr1")).toMatchObject({ next: { at: ahead(20) }, canStop: true });
    expect(by("payment_reminder:ord12345-x")).toMatchObject({ next: { at: ahead(30) }, canStop: true });
    expect(r.automations.some(a => a.key === "journey:e3")).toBe(false);   // another business's enrolment
    expect(r.automations[0].state).toBe("running");                       // running first
  });

  it("is hidden from a teammate who can't see this chat, and from other businesses", async () => {
    expect(await customerAutomations(ben, "c1", NOW)).toBeNull();
    expect(await customerAutomations(admin, "cx", NOW)).toBeNull();
    expect((await stopAutomation(ben, "c1", "journey:e1")).status).toBe(404);
  });
});

describe("stopping", () => {
  it("stops a journey and records who did it", async () => {
    expect(await stopAutomation(admin, "c1", "journey:e1")).toEqual({ ok: true });
    expect(h.m.tables.wa_sequence_enrollments.find(e => e.id === "e1")).toMatchObject({ status: "stopped", stop_reason: "Stopped by Asha", stopped_by: "asha@biz.test" });
    expect((await stopAutomation(admin, "c1", "journey:e1")).status).toBe(409);
    expect((await stopAutomation(admin, "c1", "journey:e3")).status).toBe(409);   // not this business's
    expect((await stopAutomation(admin, "c1", "journey:e4")).status).toBe(409);   // another customer's journey
    expect(h.m.tables.wa_sequence_enrollments.find(e => e.id === "e4")!.status).toBe("active");
  });

  it("ends the flow, pauses AI follow-ups until they write, cancels a review request and the payment reminder", async () => {
    h.flow = { flowId: "f1", currentNode: "x" };
    expect(await stopAutomation(admin, "c1", "flow:c1")).toEqual({ ok: true });
    expect(h.ended).toEqual(["c1"]);
    expect(await stopAutomation(admin, "c1", "ai_followup:c1")).toEqual({ ok: true });
    const conv = h.m.tables.wa_conversations.find(c => c.id === "c1")!;
    expect(conv.followup_count).toBe(3);
    expect(explainFollowup(conv as Parameters<typeof explainFollowup>[0], h.cfg, { inFlow: false, onJourney: false, optedOut: false, now: NOW }).why).toMatch(/until the customer writes again/);
    expect(await stopAutomation(admin, "c1", "review_request:rr1")).toEqual({ ok: true });
    expect(h.m.tables.wa_review_requests[0]).toMatchObject({ status: "cancelled", detail: "Cancelled by Asha" });
    expect((await stopAutomation(admin, "c1", "review_request:rr1")).status).toBe(409);
    expect(await stopAutomation(admin, "c1", "payment_reminder:ord12345-x")).toEqual({ ok: true });
    expect(h.m.tables.wa_orders[0].unpaid_reminded_at).toBeTruthy();
    expect((await stopAutomation(admin, "c1", "nonsense:1")).status).toBe(400);
  });
});

describe("why a journey stopped", () => {
  it("records the reason when a teammate's reply stops journeys, without overwriting an earlier one", async () => {
    expect(await stopAllEnrollments("919876500001", T)).toBe(1);
    const rows = h.m.tables.wa_sequence_enrollments;
    expect(rows.find(e => e.id === "e1")).toMatchObject({ status: "stopped", stop_reason: "A teammate replied in the chat" });
    expect(rows.find(e => e.id === "e2")!.stop_reason).toBe("The customer replied");
    expect(rows.find(e => e.id === "e3")!.status).toBe("active");   // other business untouched
  });

  it("still stops journeys before the reason columns exist (the reason is simply not saved)", async () => {
    const real = h.m.client.from;
    h.m.client.from = ((t: string) => {
      const b = real(t) as Record<string, unknown>;
      const upd = b.update as (p: Record<string, unknown>) => Record<string, unknown>;
      // Like Postgres before migration 20261106140000: the reason update errors.
      b.update = (p: Record<string, unknown>) => "stop_reason" in p
        ? Object.assign(upd({}), { then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42703", message: "column stop_reason does not exist" } }).then(res) })
        : upd(p);
      return b;
    }) as typeof real;
    expect(await stopAllEnrollments("919876500001", T)).toBe(1);
    expect(h.m.tables.wa_sequence_enrollments.find(e => e.id === "e1")).toMatchObject({ status: "stopped", stop_reason: null });
    h.m.client.from = real;
  });
});

describe("AI Hub routing preview", () => {
  const s = (agentId: string, score: number): AgentScore => ({ agentId, name: agentId.toUpperCase(), score });
  it("uses the same rule as live routing", () => {
    expect(decideRoute([s("a", 0.9)], null)).toMatchObject({ pick: null, reason: "too_few_agents" });
    expect(decideRoute([s("a", 0.3), s("b", 0.2)], null)).toMatchObject({ pick: null, reason: "no_good_fit" });
    expect(decideRoute([s("a", 0.6), s("b", 0.4)], null)).toMatchObject({ pick: { agentId: "a" }, reason: "best_fit" });
    expect(decideRoute([s("a", 0.6), s("b", 0.58)], "b")).toMatchObject({ pick: null, reason: "not_clearly_better" });
    expect(decideRoute([s("a", 0.6), s("b", 0.4)], "b")).toMatchObject({ pick: { agentId: "a" }, reason: "best_fit" });
    expect(decideRoute([s("a", 0.6), s("b", 0.4)], "a")).toMatchObject({ reason: "already_best" });
  });

  it("explains the outcome in plain words", () => {
    expect(explainRoute([s("sales", 0.7), s("support", 0.4)], "support", "Support")).toMatchObject({ answeredBy: { agentId: "sales" }, switches: true });
    expect(explainRoute([s("sales", 0.7), s("support", 0.4)], "support", "Support").why).toMatch(/moves from Support/);
    expect(explainRoute([s("sales", 0.2), s("support", 0.1)], "support", "Support")).toMatchObject({ answeredBy: { agentId: "support" }, switches: false });
    expect(explainRoute([s("sales", 0.2), s("support", 0.1)], null, null).why).toMatch(/default persona answers/);
  });

  it("checks separate-business mode, the auto-routing switch and AI availability first", async () => {
    h.iso = true;
    expect((await previewRoute(T, "hi", null)).why).toMatch(/separate/);
    h.iso = false;
    expect((await previewRoute(T, "hi", null)).why).toMatch(/routing is off/);
    h.settings[`${T}|agent_routing`] = { auto: true };
    h.embed = "fail";
    expect((await previewRoute(T, "hi", null)).why).toMatch(/didn't respond/);
    h.embed = [1, 0];
    h.m.tables.wa_ai_agents = [
      { id: "sales", tenant_id: T, name: "Sales", embedding: [1, 0] },
      { id: "support", tenant_id: T, name: "Support", embedding: [0, 1] },
      { id: "other", tenant_id: O, name: "Other", embedding: [1, 0] },
    ];
    const r = await previewRoute(T, "price?", null);
    expect(r.answeredBy).toEqual({ agentId: "sales", name: "Sales" });
    expect(r.scores.map(x => x.agentId)).toEqual(["sales", "support"]);   // only this business's personas
  });
});
