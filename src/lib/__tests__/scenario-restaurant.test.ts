// INDUSTRY SCENARIO — Restaurant / food delivery ("Spice Route Kitchen") on Talko AI.
//
// FEATURE CONTRACT locked in by this suite:
//  1. Ordering chatbot (flowengine): "hi" starts the flow, the greeting is
//     personalized from the contact ({{name}}), and the main menu goes out as
//     tappable buttons. A button TAP (the payload id) and TYPED text (exact
//     title, list position number, or an unambiguous loose match like "home
//     delivery please") all resolve to the same branch; genuinely off-script
//     questions go to the AI while AI auto-replies are ON, everything else —
//     and everything when the AI is OFF — gets the configurable off-script
//     nudge (rotating variations); the parked session survives up to 3
//     nudges, then hands off to a human (one final message, escalated,
//     session ended) instead of cycling the same variations forever. Flows
//     are tenant- and platform-scoped.
//  2. Quick-reply data shape: buttons render at most 3 options (Meta's cap,
//     blank titles dropped) and a list renders at most 10 rows.
//  3. Broadcast to a tag segment (campaign + store + whatsapp, real logic /
//     mocked IO): the audience resolves to active, consented, tag-matching
//     contacts of THIS tenant only; each recipient's template body is rendered
//     with their own first name; every processed recipient lands in
//     wa_send_log with its real outcome (sent/skipped/failed) and the queue +
//     campaign counters transition accordingly. Receipts only ever move a log
//     row FORWARD (sent -> delivered -> read). The daily cap, the number-health
//     pause, the 5-consecutive-failures early abort (unattempted rows stay
//     queued for retry) and the missing-creds path all hold sends safely.
//  4. template_meta + click tracking (links): per-tenant composite-key upsert;
//     a click-tracked template mints ONE unique short code per recipient into
//     wa_links and passes it as the URL-button param; /r/<code> resolves and
//     counts the click.
//  5. Preflight (templateIssues): the classic template mistakes are blocked in
//     plain English before a send hits Meta.
//  6. Entitlements: the broadcasts gate is dormant until the platform flag is
//     on; when enforcing, the plan default blocks with an upgrade suggestion
//     (cheapest ACTIVE plan with the feature), per-tenant overrides and
//     grandfathering win, and every error path fails OPEN.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub (rpc
// deliberately "not deployed" so the documented fallback paths run), the Meta
// Graph API is a recorded fetch stub, channels/quota/plans/flags/usage are
// module mocks. Zero network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mock state (hoisted above the vi.mock factories) ──────────────────
const { tables, mocks } = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  mocks: {
    // channels + quota (campaign.ts / flowengine.ts / sequences.ts)
    credsFor: vi.fn(),
    getChannel: vi.fn(),
    isMarketingSendable: vi.fn(),
    getDailyCapForTier: vi.fn(),
    // entitlements.ts leaf deps
    getFlag: vi.fn(),
    getPlan: vi.fn(),
    listPlans: vi.fn(),
    getTenantUsage: vi.fn(),
    // flowengine leaf deps that must never do real work here
    looksLikeCity: vi.fn(),
    syncLeadProfile: vi.fn(),
  },
}));

// ── Chainable, thenable in-memory supabase stub ───────────────────────────────
// Filters collect on the chain; the op only runs when the builder is awaited.
// rpc() always reports "not deployed" so claimPending/registerClick exercise
// their real production fallback paths.
vi.mock("@/lib/supabase", () => {
  let autoId = 0;
  type Row = Record<string, unknown>;
  function builder(table: string) {
    const state = {
      filters: [] as ((r: Row) => boolean)[],
      op: "select" as "select" | "insert" | "update" | "upsert" | "delete",
      payload: null as unknown,
      onConflict: null as string | null,
      ignoreDuplicates: false,
      single: false,
      head: false,
      order: null as { col: string; asc: boolean } | null,
      limit: null as number | null,
    };
    const matches = () => (tables[table] ?? []).filter(r => state.filters.every(f => f(r)));
    const stamp = (r: Row): Row => ({ id: `${table}-${++autoId}`, created_at: new Date().toISOString(), ...r });
    function run(): { data: unknown; error: null; count: number | null } {
      const all = (tables[table] ??= []);
      if (state.op === "insert") {
        const list = ([] as Row[]).concat(state.payload as Row | Row[]).map(stamp);
        all.push(...list);
        return { data: state.single ? list[0] : list, error: null, count: null };
      }
      if (state.op === "upsert") {
        const keys = (state.onConflict ?? "").split(",").map(s => s.trim()).filter(Boolean);
        const returned: Row[] = [];
        for (const raw of ([] as Row[]).concat(state.payload as Row | Row[])) {
          const hit = keys.length ? all.find(r => keys.every(k => r[k] === raw[k])) : undefined;
          if (hit) { if (!state.ignoreDuplicates) { Object.assign(hit, raw); returned.push(hit); } }
          else { const row = stamp(raw); all.push(row); returned.push(row); }
        }
        return { data: state.single ? returned[0] ?? null : returned, error: null, count: null };
      }
      if (state.op === "update") {
        const hits = matches();
        for (const r of hits) Object.assign(r, state.payload as Row);
        return { data: state.single ? hits[0] ?? null : hits, error: null, count: null };
      }
      if (state.op === "delete") {
        const hits = new Set(matches());
        tables[table] = all.filter(r => !hits.has(r));
        return { data: null, error: null, count: null };
      }
      // select
      let out = matches().slice();
      if (state.order) {
        const { col, asc } = state.order;
        out.sort((a, b) => {
          const x = a[col] as string | number, y = b[col] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (state.limit != null) out = out.slice(0, state.limit);
      if (state.head) return { data: null, error: null, count: out.length };
      return { data: state.single ? out[0] ?? null : out, error: null, count: out.length };
    }
    const api = {
      select: (_cols?: string, opts?: { head?: boolean; count?: string }) => { if (opts?.head) state.head = true; return api; },
      eq: (col: string, val: unknown) => { state.filters.push(r => r[col] === val); return api; },
      neq: (col: string, val: unknown) => { state.filters.push(r => r[col] !== val); return api; },
      in: (col: string, vals: unknown[]) => { state.filters.push(r => vals.includes(r[col])); return api; },
      gt: (col: string, val: string | number) => { state.filters.push(r => r[col] != null && (r[col] as string | number) > val); return api; },
      gte: (col: string, val: string | number) => { state.filters.push(r => r[col] != null && (r[col] as string | number) >= val); return api; },
      lte: (col: string, val: string | number) => { state.filters.push(r => r[col] != null && (r[col] as string | number) <= val); return api; },
      like: (col: string, pattern: string) => {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
        state.filters.push(r => typeof r[col] === "string" && re.test(r[col] as string));
        return api;
      },
      // Postgres @> — array containment (tags) or jsonb key/value (attributes).
      contains: (col: string, val: unknown) => {
        state.filters.push(r => {
          const cell = r[col];
          if (Array.isArray(val)) return Array.isArray(cell) && val.every(v => (cell as unknown[]).includes(v));
          if (val && typeof val === "object") {
            const obj = (cell ?? {}) as Row;
            return Object.entries(val as Row).every(([k, v]) => obj[k] === v);
          }
          return false;
        });
        return api;
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) state.filters.push(r => r[col] !== null && r[col] !== undefined);
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => { state.order = { col, asc: opts?.ascending ?? true }; return api; },
      limit: (n: number) => { state.limit = n; return api; },
      single: () => { state.single = true; return api; },
      maybeSingle: () => { state.single = true; return api; },
      insert: (row: unknown) => { state.op = "insert"; state.payload = row; return api; },
      update: (patch: Row) => { state.op = "update"; state.payload = patch; return api; },
      upsert: (row: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        state.op = "upsert"; state.payload = row;
        state.onConflict = opts?.onConflict ?? null;
        state.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
        return api;
      },
      delete: () => { state.op = "delete"; return api; },
      then: (onOk?: (v: { data: unknown; error: null; count: number | null }) => unknown, onErr?: (e: unknown) => unknown) => {
        try { const v = run(); return Promise.resolve(onOk ? onOk(v) : (v as never)); }
        catch (e) { if (onErr) return Promise.resolve(onErr(e)); return Promise.reject(e); }
      },
    };
    return api;
  }
  const rpc = (_fn: string, _args?: unknown) => ({
    then: (onOk?: (v: { data: null; error: { message: string } }) => unknown) =>
      Promise.resolve(onOk ? onOk({ data: null, error: { message: "rpc not deployed in tests" } }) : undefined),
  });
  return { db: () => ({ from: builder, rpc }) };
});

vi.mock("@/lib/channels", () => ({
  credsFor: mocks.credsFor,
  getChannel: mocks.getChannel,
  isMarketingSendable: mocks.isMarketingSendable,
  // Real (pure) precedence helpers — conversation override → channel default → global.
  effectiveAgentId: (conv: { agentId?: string | null } | null | undefined, channel?: { agentId?: string | null } | null) => conv?.agentId ?? channel?.agentId ?? null,
  effectiveKbTag: (conv: { primaryKbTag?: string | null } | null | undefined, channel?: { kbTag?: string | null } | null) => conv?.primaryKbTag ?? channel?.kbTag ?? null,
}));
vi.mock("@/lib/quota", () => ({
  getDailyCapForTier: mocks.getDailyCapForTier,
}));
vi.mock("@/lib/plans", () => ({
  getPlan: mocks.getPlan,
  listPlans: mocks.listPlans,
}));
vi.mock("@/lib/flags", () => ({
  getFlag: mocks.getFlag,
}));
vi.mock("@/lib/usage", () => ({
  getTenantUsage: mocks.getTenantUsage,
}));
// flowengine leaf deps — never let the AI city-check or the CRM sync run.
vi.mock("@/lib/llm", () => ({
  looksLikeCity: mocks.looksLikeCity,
}));
vi.mock("@/lib/leadsquared", () => ({
  syncLeadProfile: mocks.syncLeadProfile,
}));

// SUTs — real modules, exercised against the stubs above.
import {
  handleFlowMessage, drySender, matchOption, fillVars,
  type SimOutput, type FlowGraph, type FlowNode,
} from "@/lib/flowengine";
import { startSend, drainQueue, fireScheduledCampaign } from "@/lib/campaign";
import { createCampaign, recipientsForAudience, enqueue, updateLogByMessageId, logCounts, type Campaign } from "@/lib/store";
import { setTemplateMeta, getTrackedUrls, registerClick } from "@/lib/links";
import { templateIssues } from "@/lib/preflight";
import { checkFeature, hasFeature, getEntitlements } from "@/lib/entitlements";
import { DEFAULT_TENANT_ID } from "@/lib/tenant";

// Spice Route Kitchen (the restaurant) and a rival to prove tenant isolation.
const SPICE = "33333333-3333-3333-3333-333333333333";
const RIVAL = "44444444-4444-4444-4444-444444444444";
const ROHAN = "919876543210"; // phones are digits-only in storage
const CONV = "conv-rohan";

// ── Graph API fetch stub (whatsapp.sendCampaign is REAL in this suite) ─────────
const graphCalls: { url: string; body: Record<string, any> }[] = [];
const failPhones = new Set<string>();

// ── Fixtures ──────────────────────────────────────────────────────────────────
function orderFlowGraph(): FlowGraph {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "welcome", type: "message", position: { x: 0, y: 0 }, data: { text: "Hi {{name}}! Welcome to Spice Route Kitchen 🍛" } },
      { id: "menu", type: "buttons", position: { x: 0, y: 0 }, data: {
        text: "What would you like to do?",
        buttons: [
          { id: "opt-order", title: "Order Food" },
          { id: "opt-table", title: "Book a Table" },
          { id: "opt-agent", title: "Talk to staff" },
        ],
      } },
      { id: "ordertype", type: "buttons", position: { x: 0, y: 0 }, data: {
        text: "How should we get the food to you?",
        saveAs: "order_type",
        buttons: [
          { id: "opt-delivery", title: "Delivery" },
          { id: "opt-pickup", title: "Pickup" },
        ],
      } },
      { id: "confirm-delivery", type: "message", position: { x: 0, y: 0 }, data: { text: "Perfect, {{name}} — we deliver in 45 minutes. Track your order at spiceroutekitchen.in/track" } },
      { id: "confirm-pickup", type: "message", position: { x: 0, y: 0 }, data: { text: "Great — pickup is ready 25 minutes after you order, {{name}}." } },
      { id: "done", type: "end", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "welcome" },
      { id: "e2", source: "welcome", target: "menu" },
      { id: "e3", source: "menu", sourceHandle: "opt-order", target: "ordertype" },
      { id: "e4", source: "ordertype", sourceHandle: "opt-delivery", target: "confirm-delivery" },
      { id: "e5", source: "ordertype", sourceHandle: "opt-pickup", target: "confirm-pickup" },
      { id: "e6", source: "confirm-delivery", target: "done" },
      { id: "e7", source: "confirm-pickup", target: "done" },
    ],
  };
}

function seedOrderFlow(graph: FlowGraph = orderFlowGraph()) {
  tables["wa_flows"] = [{
    id: "flow-order", tenant_id: SPICE, name: "Order journey", active: true,
    trigger_keywords: ["hi", "menu"], platform: "whatsapp", channel_id: null, primary_kb_tag: null,
    graph, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
  }];
}

function seedRohan() {
  tables["contacts"] = [{
    id: "c-rohan", tenant_id: SPICE, phone: ROHAN, name: "Rohan Mehta", email: null,
    tags: ["regulars"], attributes: {}, status: "active", opted_in: true, created_at: "2026-06-01T00:00:00Z",
  }];
}

function parkSession(nodeId: string, state: Record<string, unknown> = {}) {
  tables["wa_flow_sessions"] = [{
    id: "sess-1", tenant_id: SPICE, conversation_id: CONV, flow_id: "flow-order",
    current_node: nodeId, state, updated_at: new Date().toISOString(),
  }];
}

const contact = (id: string, tenantId: string, phone: string, name: string, tags: string[], optedIn: boolean) => ({
  id, tenant_id: tenantId, phone, name, email: null, tags, attributes: {},
  status: "active", opted_in: optedIn, created_at: "2026-06-01T00:00:00Z",
});

const PLANS = [
  { name: "starter", active: true, priceCents: 99900, features: { broadcasts: false, ch_whatsapp: true, flows: true }, limits: { contacts: 2000, conversations_per_month: 1000, messages_per_month: 5000, channels: 1, team_seats: 2 } },
  { name: "growth", active: true, priceCents: 249900, features: { broadcasts: true, ch_whatsapp: true, flows: true } },
  { name: "earlybird", active: false, priceCents: 49900, features: { broadcasts: true } }, // retired plan — must never be suggested
];

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  graphCalls.length = 0;
  failPhones.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    graphCalls.push({ url: String(url), body });
    if (failPhones.has(String(body.to))) {
      return { ok: false, status: 400, json: async () => ({ error: { message: "(#131026) Message undeliverable" } }), text: async () => "" } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${body.to}` }] }), text: async () => "" } as unknown as Response;
  }));
  mocks.credsFor.mockReset().mockResolvedValue({ token: "tok_spice", phoneId: "ph_spice", wabaId: "waba_spice" });
  mocks.getChannel.mockReset().mockResolvedValue(null);
  mocks.isMarketingSendable.mockReset().mockReturnValue(true);
  mocks.getDailyCapForTier.mockReset().mockReturnValue(1000);
  mocks.getFlag.mockReset().mockImplementation(async (_k: string, d: boolean) => d);
  mocks.getPlan.mockReset().mockImplementation(async (name: string) => PLANS.find(p => p.name === name) ?? null);
  mocks.listPlans.mockReset().mockResolvedValue(PLANS);
  mocks.getTenantUsage.mockReset().mockResolvedValue(undefined);
  mocks.looksLikeCity.mockReset().mockResolvedValue(true);
  mocks.syncLeadProfile.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("Restaurant / food delivery — Spice Route Kitchen on Talko AI", () => {

  // ── 1. Ordering chatbot: menu → order type → confirmation ───────────────────
  describe("ordering chatbot (flowengine buttons flow)", () => {
    it("'hi' starts the flow: personalized greeting, main-menu buttons, session parked at the menu", async () => {
      seedOrderFlow(); seedRohan();
      const out: SimOutput[] = [];
      const handled = await handleFlowMessage(CONV, ROHAN, "Hi!", { sender: drySender(out), tenantId: SPICE });

      expect(handled).toBe(true);
      expect(out[0]).toEqual({ kind: "text", body: "Hi Rohan! Welcome to Spice Route Kitchen 🍛" }); // {{name}} → first name
      expect(out[1]).toMatchObject({
        kind: "buttons",
        body: "What would you like to do?",
        options: ["Order Food", "Book a Table", "Talk to staff"],
      });
      expect(tables["wa_flow_sessions"]).toHaveLength(1);
      expect(tables["wa_flow_sessions"][0]).toMatchObject({
        conversation_id: CONV, flow_id: "flow-order", current_node: "menu", tenant_id: SPICE,
      });
    });

    it("a button TAP (payload id) and TYPED title both branch to the delivery/pickup question", async () => {
      seedOrderFlow(); seedRohan();

      // Real WhatsApp button clicks arrive as the button's payload id.
      parkSession("menu");
      let out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "opt-order", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0]).toMatchObject({ kind: "buttons", body: "How should we get the food to you?", options: ["Delivery", "Pickup"] });
      // The branch remembers the menu it came from so old taps still work later.
      expect(tables["wa_flow_sessions"][0]).toMatchObject({ current_node: "ordertype", state: { menu: "menu" } });

      // A typed reply with the option's title (any case/punctuation) matches too.
      parkSession("menu");
      out = [];
      expect(await handleFlowMessage(CONV, ROHAN, "order food", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0]).toMatchObject({ kind: "buttons", options: ["Delivery", "Pickup"] });
    });

    it("typed picks reach the confirmation: loose text ('home delivery please') and a numbered pick ('2') both work, then the session closes", async () => {
      seedOrderFlow(); seedRohan();

      // "home delivery please" unambiguously contains "Delivery".
      parkSession("ordertype", { menu: "menu" });
      let out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "home delivery please", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0].body).toBe("Perfect, Rohan — we deliver in 45 minutes. Track your order at spiceroutekitchen.in/track");
      expect(tables["wa_flow_sessions"]).toHaveLength(0); // End node closed the flow

      // Numbered text-menu pick: "2" = the second option (Pickup).
      parkSession("ordertype", { menu: "menu" });
      out = [];
      expect(await handleFlowMessage(CONV, ROHAN, "2", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0].body).toBe("Great — pickup is ready 25 minutes after you order, Rohan.");
      expect(tables["wa_flow_sessions"]).toHaveLength(0);

      // matchOption is the pure resolver behind all of this: too-short or
      // ambiguous input must return null so the AI answers instead of guessing.
      const node = orderFlowGraph().nodes.find(n => n.id === "ordertype") as FlowNode;
      expect(matchOption(node, "del")).toBeNull();          // < 4 chars — never guess
      expect(matchOption(node, "OPT-PICKUP")).toBe("opt-pickup"); // payload id, case-insensitive
      expect(matchOption(node, "99")).toBeNull();           // out-of-range number
    });

    it("off-script questions go to the AI when it's ON; with the AI OFF the nudge replies — and the parked session survives", async () => {
      seedOrderFlow(); seedRohan();
      parkSession("ordertype", { menu: "menu" });

      // AI ON (the default): a real question is NOT consumed — the RAG
      // assistant answers it, and the menu keeps waiting underneath.
      const outQ: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "do you have paneer tikka?", { sender: drySender(outQ), tenantId: SPICE })).toBe(false);
      expect(outQ).toHaveLength(0);
      expect(tables["wa_flow_sessions"][0]).toMatchObject({ current_node: "ordertype" }); // still waiting

      // …but non-question rambling gets the off-script nudge even with AI on.
      const out1: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "jalfrezi shawarma falafel", { sender: drySender(out1), tenantId: SPICE })).toBe(true);
      expect(out1).toHaveLength(1);

      // AI OFF: the SAME question now gets a nudge (a different variation —
      // they rotate) — a flow-first setup never goes silent mid-flow.
      (tables["wa_settings"] ??= []).push({ tenant_id: SPICE, key: "ai_replies", value: { enabled: false } });
      const out2: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "do you have paneer tikka?", { sender: drySender(out2), tenantId: SPICE })).toBe(true);
      expect(out2).toHaveLength(1);
      expect(out2[0].body).not.toBe(out1[0].body);

      // Nudges cap at 3 per menu: one more fires, then the flow hands off to a
      // human instead of cycling the same variations forever — one final
      // message, the session ends (no more automated guessing).
      expect(await handleFlowMessage(CONV, ROHAN, "no rice?", { sender: drySender([]), tenantId: SPICE })).toBe(true);
      const out4: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "seriously?", { sender: drySender(out4), tenantId: SPICE })).toBe(true);
      expect(out4).toHaveLength(1);
      expect(out4[0].body).toContain("Connecting you with our team");
      expect(tables["wa_flow_sessions"]).toHaveLength(0);   // handed off — session ended

      // Handed off means handed off: a bare reply is NOT reinterpreted as a
      // menu pick anymore — only an explicit restart keyword begins a new order.
      const out5: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "pickup", { sender: drySender(out5), tenantId: SPICE })).toBe(false);
      expect(out5).toHaveLength(0);
    });

    it("flows are tenant- and platform-scoped: no cross-restaurant or cross-channel triggering", async () => {
      seedOrderFlow(); seedRohan();

      // The rival restaurant has no flows — same keyword, nothing happens.
      const out: SimOutput[] = [];
      expect(await handleFlowMessage("conv-rival", "917000000001", "hi", { sender: drySender(out), tenantId: RIVAL })).toBe(false);
      expect(out).toHaveLength(0);

      // An Instagram-only flow never fires for a WhatsApp inbound.
      tables["wa_flows"][0].platform = "instagram";
      expect(await handleFlowMessage(CONV, ROHAN, "hi", { sender: drySender(out), tenantId: SPICE })).toBe(false);
      expect(out).toHaveLength(0);
      expect(tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it("a first-time caller with no contact row never sees a raw {{name}} placeholder", async () => {
      // A brand-new caller (or webchat visitor) has no contacts row yet — tokens
      // still resolve to "" per fillVars' contract instead of leaking literally.
      seedOrderFlow(); // no contacts seeded
      expect(fillVars("Hi {{name}}!", null)).toBe("Hi !");
      const out: SimOutput[] = [];
      await handleFlowMessage("conv-new", "917013331111", "hi", { sender: drySender(out), tenantId: SPICE });
      expect(out[0].body).toBe("Hi ! Welcome to Spice Route Kitchen 🍛");
    });
  });

  // ── 2. Quick-reply data shape (Meta caps enforced at lib level) ──────────────
  describe("quick replies / menu shape", () => {
    it("a buttons node drops blank titles and caps at WhatsApp's 3 buttons", async () => {
      tables["wa_flows"] = [{
        id: "flow-specials", tenant_id: SPICE, name: "Specials", active: true,
        trigger_keywords: ["specials"], platform: "whatsapp", channel_id: null, primary_kb_tag: null,
        graph: {
          nodes: [
            { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
            { id: "picks", type: "buttons", position: { x: 0, y: 0 }, data: {
              text: "Today's specials — pick one:",
              buttons: [
                { id: "b1", title: "Butter Chicken" },
                { id: "b2", title: "   " },              // blank — dropped
                { id: "b3", title: "Paneer Tikka" },
                { id: "b4", title: "Dal Makhani" },
                { id: "b5", title: "Veg Biryani" },       // 4th real option — cut by the cap
              ],
            } },
          ],
          edges: [{ id: "e1", source: "start", target: "picks" }],
        },
        created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
      }];
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "specials", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0].options).toEqual(["Butter Chicken", "Paneer Tikka", "Dal Makhani"]);
    });

    it("a list node (flat builder rows) caps at Meta's 10 rows", async () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ id: `thali-${i + 1}`, title: `Thali #${i + 1}` }));
      tables["wa_flows"] = [{
        id: "flow-thali", tenant_id: SPICE, name: "Thali menu", active: true,
        trigger_keywords: ["thali"], platform: "whatsapp", channel_id: null, primary_kb_tag: null,
        graph: {
          nodes: [
            { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
            { id: "thalis", type: "list", position: { x: 0, y: 0 }, data: { text: "Our thalis:", buttonText: "See menu", rows } },
          ],
          edges: [{ id: "e1", source: "start", target: "thalis" }],
        },
        created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
      }];
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, ROHAN, "thali", { sender: drySender(out), tenantId: SPICE })).toBe(true);
      expect(out[0].kind).toBe("list");
      expect(out[0].options).toHaveLength(10);
      expect(out[0].options![9]).toBe("Thali #10"); // rows 11-12 cut
    });
  });

  // ── 3. Broadcast to the 'regulars' tag ───────────────────────────────────────
  describe("broadcast to a tag segment (campaign + preflight + send_log)", () => {
    it("fires the scheduled 'Weekend Biryani Fest' blast: tag+consent audience, per-recipient {name} render, real outcomes in send_log/queue/campaign", async () => {
      tables["contacts"] = [
        contact("c1", SPICE, ROHAN, "Rohan Mehta", ["regulars"], true),
        contact("c2", SPICE, "919812345678", "Meera Iyer", ["regulars"], true),
        contact("c3", SPICE, "917700900800", "Priya Nair", ["regulars"], true),      // sent STOP earlier
        contact("c4", SPICE, "915555000111", "Dead Number", ["regulars"], true),     // Meta rejects
        contact("c5", SPICE, "918888777666", "Walk-in Guest", [], true),             // not a regular
        contact("c6", SPICE, "917777666555", "CSV Import", ["regulars"], false),     // no consent proof
        contact("c7", RIVAL, "916666555444", "Rival Regular", ["regulars"], true),   // other restaurant
      ];
      tables["wa_optouts"] = [{ id: "o1", tenant_id: SPICE, phone: "7700900800", reason: "inbound STOP" }];
      failPhones.add("915555000111");
      seedOrderFlow(); // the reply flow for "bot on broadcast"

      const camp = await createCampaign({
        name: "Weekend Biryani Fest", templateName: "weekend_biryani_fest", languageCode: "en",
        variables: ["{name}", "Weekend Biryani Fest"], headerImageUrl: "https://cdn.spiceroute.in/biryani.jpg",
        audience: { mode: "tag", tag: "regulars" }, status: "scheduled",
        scheduledFor: "2026-07-04T04:30:00Z", replyFlowId: "flow-order",
      }, SPICE);

      await fireScheduledCampaign(camp);

      // Audience: active + consented + tagged + THIS tenant only.
      expect(tables["wa_send_queue"].map(q => q.phone).sort()).toEqual(
        ["915555000111", "917700900800", "919812345678", "919876543210"],
      );

      // Per-recipient template variable rendering: {name} → each customer's first name.
      const rohanCall = graphCalls.find(c => c.body.to === ROHAN)!;
      expect(rohanCall.url).toBe("https://graph.facebook.com/v22.0/ph_spice/messages");
      expect(rohanCall.body.template.name).toBe("weekend_biryani_fest");
      expect(rohanCall.body.template.components).toEqual([
        { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.spiceroute.in/biryani.jpg" } }] },
        { type: "body", parameters: [{ type: "text", text: "Rohan" }, { type: "text", text: "Weekend Biryani Fest" }] },
      ]);
      const meeraCall = graphCalls.find(c => c.body.to === "919812345678")!;
      expect(meeraCall.body.template.components[1].parameters[0].text).toBe("Meera");
      expect(graphCalls.some(c => c.body.to === "917700900800")).toBe(false); // opted-out: never hits Meta

      // send_log: one row per processed recipient with its REAL outcome.
      const logByPhone = Object.fromEntries(tables["wa_send_log"].map(r => [r.phone as string, r]));
      expect(logByPhone[ROHAN]).toMatchObject({ status: "sent", meta_message_id: `wamid.${ROHAN}`, tenant_id: SPICE });
      expect(logByPhone["917700900800"]).toMatchObject({ status: "skipped", error_detail: "opted out" });
      expect(logByPhone["915555000111"]).toMatchObject({ status: "failed", error_detail: "(#131026) Message undeliverable" });

      // Queue rows transition to their outcome.
      expect(Object.fromEntries(tables["wa_send_queue"].map(q => [q.phone as string, q.status]))).toEqual({
        [ROHAN]: "sent", "919812345678": "sent", "917700900800": "skipped", "915555000111": "failed",
      });

      // Campaign counters recomputed from the log; 2 sent + 1 failed = "partial".
      const row = tables["wa_campaigns"].find(c => c.id === camp.id)!;
      expect(row).toMatchObject({ status: "partial", sent_count: 2, failed_count: 1, total_recipients: 4, scheduled_for: null });
      expect(String(row.error_summary)).toContain("131026");

      // Bot-on-broadcast: only DELIVERED recipients get armed for the reply flow.
      expect((tables["wa_flow_arms"] ?? []).map(a => a.phone).sort()).toEqual(["9812345678", "9876543210"]);
    });

    it("delivery receipts only move a send_log row FORWARD, and logCounts rolls up per recipient", async () => {
      tables["wa_send_log"] = [
        { id: "l1", tenant_id: SPICE, campaign_id: "camp-1", phone: ROHAN, recipient_name: "Rohan Mehta", status: "sent", meta_message_id: "wamid.a" },
        { id: "l2", tenant_id: SPICE, campaign_id: "camp-1", phone: "919812345678", recipient_name: "Meera Iyer", status: "sent", meta_message_id: "wamid.b" },
      ];
      await updateLogByMessageId("wamid.a", "delivered", "2026-07-05T10:00:00Z");
      expect(tables["wa_send_log"][0]).toMatchObject({ status: "delivered", delivered_at: "2026-07-05T10:00:00Z" });

      await updateLogByMessageId("wamid.a", "read", "2026-07-05T10:05:00Z");
      expect(tables["wa_send_log"][0]).toMatchObject({ status: "read", read_at: "2026-07-05T10:05:00Z" });

      // Meta ships receipts out of order / duplicated — a late "delivered" must
      // never downgrade a "read" row (the read count would silently shrink).
      await updateLogByMessageId("wamid.a", "delivered", "2026-07-05T10:09:00Z");
      expect(tables["wa_send_log"][0]).toMatchObject({ status: "read", delivered_at: "2026-07-05T10:05:00Z" });

      expect(await logCounts("camp-1")).toEqual({ sent: 2, failed: 0, delivered: 1, read: 1 });
    });

    it("the rolling 24h cap holds the blast: nothing hits Meta, the queue stays pending, and the summary explains it", async () => {
      mocks.getDailyCapForTier.mockReturnValue(25);
      tables["wa_send_log"] = Array.from({ length: 25 }, (_, i) => ({
        id: `pl${i}`, tenant_id: SPICE, campaign_id: "camp-earlier", phone: `9190000${String(i).padStart(5, "0")}`,
        status: "sent", sent_at: new Date(Date.now() - 3600_000).toISOString(),
      }));
      const camp = await createCampaign({ name: "Lunch offer", templateName: "lunch_offer", languageCode: "en", variables: [] }, SPICE);

      // enqueue normalizes to digits and collapses the same person's variants.
      expect(await enqueue(camp.id, [
        { phone: "+91 98765 43210", fullName: "Rohan Mehta" },
        { phone: "919876543210", fullName: "Rohan Mehta" },   // duplicate of the above
        { phone: "919812345678", fullName: "Meera Iyer" },
      ], SPICE)).toBe(2);

      const r = await drainQueue(camp.id);
      expect(r).toEqual({ sentNow: 0, queuedRemaining: 2, status: "sending" });
      expect(graphCalls).toHaveLength(0);
      expect(tables["wa_send_queue"].every(q => q.status === "pending")).toBe(true);
      const row = tables["wa_campaigns"].find(c => c.id === camp.id)!;
      expect(String(row.error_summary)).toContain("24h send limit (25) reached");
    });

    it("a RED-quality number pauses marketing sends (auto-resumes later) instead of burning the number", async () => {
      mocks.getChannel.mockResolvedValue({ id: "chan-spice", kind: "whatsapp", qualityRating: "RED" });
      mocks.isMarketingSendable.mockReturnValue(false);
      const camp = await createCampaign({ name: "Dinner push", templateName: "dinner_push", languageCode: "en", variables: [], channelId: "chan-spice" }, SPICE);
      await enqueue(camp.id, [{ phone: ROHAN, fullName: "Rohan Mehta" }, { phone: "919812345678", fullName: "Meera Iyer" }], SPICE);

      const r = await drainQueue(camp.id);
      expect(r).toEqual({ sentNow: 0, queuedRemaining: 2, status: "sending" }); // stays "sending" so it auto-resumes
      expect(mocks.getChannel).toHaveBeenCalledWith("chan-spice", SPICE);
      expect(graphCalls).toHaveLength(0);
      const row = tables["wa_campaigns"].find(c => c.id === camp.id)!;
      expect(String(row.error_summary)).toContain("number quality is RED");
      expect(String(row.error_summary)).toContain("(2 queued)");
    });

    it("early abort after 5 consecutive Meta failures: unattempted recipients stay queued for retry, never marked sent", async () => {
      const phones = Array.from({ length: 7 }, (_, i) => `91900000000${i + 1}`);
      for (const p of phones) failPhones.add(p);
      const camp = await createCampaign({ name: "Holi offer", templateName: "holi_offer", languageCode: "en", variables: [] }, SPICE);
      await enqueue(camp.id, phones.map(p => ({ phone: p, fullName: "Guest" })), SPICE);

      const r = await drainQueue(camp.id);
      expect(graphCalls).toHaveLength(5); // aborted after 5 consecutive failures
      const statuses = tables["wa_send_queue"].map(q => q.status);
      expect(statuses.filter(s => s === "failed")).toHaveLength(5);
      expect(statuses.filter(s => s === "pending")).toHaveLength(2); // released, not dropped
      expect(r).toEqual({ sentNow: 0, queuedRemaining: 2, status: "sending" });
      expect(tables["wa_send_log"].filter(l => l.status === "failed")).toHaveLength(5);
    }, 10000);

    it("missing WhatsApp credentials stop the send before anything is queued", async () => {
      const savedToken = process.env.META_WA_ACCESS_TOKEN, savedPhone = process.env.META_WA_PHONE_NUMBER_ID;
      delete process.env.META_WA_ACCESS_TOKEN;
      delete process.env.META_WA_PHONE_NUMBER_ID;
      mocks.credsFor.mockResolvedValue(null); // tenant never connected a number
      try {
        const camp = await createCampaign({ name: "No number yet", templateName: "welcome_offer", languageCode: "en", variables: [] }, SPICE);
        const r = await startSend(camp as Campaign, [{ phone: ROHAN, fullName: "Rohan Mehta" }]);
        expect(r.message).toBe("WhatsApp credentials not configured.");
        expect(r.enqueued).toBe(0);
        expect(tables["wa_send_queue"] ?? []).toHaveLength(0);
        expect(graphCalls).toHaveLength(0);
      } finally {
        if (savedToken !== undefined) process.env.META_WA_ACCESS_TOKEN = savedToken;
        if (savedPhone !== undefined) process.env.META_WA_PHONE_NUMBER_ID = savedPhone;
      }
    });
  });

  // ── 4. template_meta + click tracking ────────────────────────────────────────
  describe("template_meta + click-tracked menu button (links)", () => {
    it("setTemplateMeta upserts on the (tenant, template) composite key and stays per-tenant", async () => {
      await setTemplateMeta("weekend_biryani_fest", { clickTracking: true, trackedUrls: [{ index: 0, url: "https://spiceroutekitchen.in/menu" }] }, SPICE);
      await setTemplateMeta("weekend_biryani_fest", { clickTracking: true, trackedUrls: [{ index: 0, url: "https://spiceroutekitchen.in/weekend-menu" }] }, SPICE);

      expect(tables["wa_template_meta"]).toHaveLength(1); // updated in place, not duplicated
      expect(await getTrackedUrls("weekend_biryani_fest", SPICE)).toEqual([{ index: 0, url: "https://spiceroutekitchen.in/weekend-menu" }]);
      expect(await getTrackedUrls("weekend_biryani_fest", RIVAL)).toEqual([]); // rival's template of the same name is separate

      // Tracking switched off → no tracked URLs even though rows exist.
      await setTemplateMeta("weekend_biryani_fest", { clickTracking: false, trackedUrls: [{ index: 0, url: "https://spiceroutekitchen.in/menu" }] }, SPICE);
      expect(await getTrackedUrls("weekend_biryani_fest", SPICE)).toEqual([]);
    });

    it("a click-tracked blast mints one unique code per recipient, sends it as the URL-button param, and /r/<code> counts the click", async () => {
      await setTemplateMeta("weekend_biryani_fest", { clickTracking: true, trackedUrls: [{ index: 0, url: "https://spiceroutekitchen.in/menu" }] }, SPICE);
      const camp = await createCampaign({ name: "Menu blast", templateName: "weekend_biryani_fest", languageCode: "en", variables: ["{name}"] }, SPICE);

      const r = await startSend(camp as Campaign, [
        { phone: ROHAN, fullName: "Rohan Mehta" },
        { phone: "919812345678", fullName: "Meera Iyer" },
      ]);
      expect(r.status).toBe("sent");
      expect(r.message).toBe("Sent to 2 recipients.");

      const links = tables["wa_links"];
      expect(links).toHaveLength(2); // one row per recipient
      expect(new Set(links.map(l => l.code)).size).toBe(2); // unique codes
      for (const call of graphCalls) {
        const link = links.find(l => l.phone === call.body.to)!;
        expect(link.target_url).toBe("https://spiceroutekitchen.in/menu");
        const btn = call.body.template.components.find((c: { type: string }) => c.type === "button");
        expect(btn).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: link.code }] });
      }

      // Rohan taps "View menu" → /r/<code> resolves, counts once, stamps first click.
      // (The atomic RPC isn't deployed in tests, so this exercises the documented
      // non-atomic fallback path in registerClick.)
      const code = String(links[0].code);
      expect(await registerClick(code)).toBe("https://spiceroutekitchen.in/menu");
      expect(links[0].clicks).toBe(1);
      expect(links[0].first_clicked_at).toBeTruthy();
      expect(await registerClick("zzzzzzzz")).toBeNull(); // unknown code → 404 upstream
    });
  });

  // ── 5. Template preflight ─────────────────────────────────────────────────────
  describe("template send preflight (templateIssues)", () => {
    const orderConfirmTpl = {
      name: "order_confirmation",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Thanks {{1}}! Your {{2}} is confirmed — arriving in {{3}} minutes. Show this message for 10% off your next dine-in." },
      ],
    };

    it("a fully-supplied approved order-confirmation template passes clean", () => {
      const r = templateIssues(orderConfirmTpl, {
        bodyParams: ["Rohan", "Paneer Tikka Thali", "45"],
        headerImageUrl: "https://cdn.spiceroute.in/thali.jpg",
      });
      expect(r.blocking).toEqual([]);
      expect(r.warnings).toEqual([]);
    });

    it("blocks the classic mistakes in plain English before the send hits Meta", () => {
      // Only the customer's name filled, header photo of the dish missing.
      const partial = templateIssues(orderConfirmTpl, { bodyParams: ["Rohan"] });
      expect(partial.blocking.some(b => /needs 3 values/.test(b) && /you've filled 1/.test(b))).toBe(true);
      expect(partial.blocking.some(b => /image header/.test(b) && /add the image link/.test(b))).toBe(true);

      // Still in Meta review → cannot send at all.
      const pending = templateIssues({ ...orderConfirmTpl, status: "PENDING" }, {
        bodyParams: ["Rohan", "Paneer Tikka Thali", "45"], headerImageUrl: "https://cdn.spiceroute.in/thali.jpg",
      });
      expect(pending.blocking.some(b => b.includes("isn't approved yet (status: PENDING)"))).toBe(true);

      // A dish-carousel template can't go out as a broadcast — flows only, ≥2 cards.
      const carousel = { name: "signature_dishes", status: "APPROVED", components: [{ type: "CAROUSEL", cards: [] }] };
      expect(templateIssues(carousel, {}, "broadcast").blocking.some(b => /carousel/.test(b) && /broadcasts can't/.test(b))).toBe(true);
      expect(templateIssues(carousel, { cards: [{}, {}] }, "flow").blocking).toEqual([]);
      expect(templateIssues(null).blocking[0]).toMatch(/wasn't found/); // deleted / typo'd template
    });
  });

  // ── 6. Broadcasts entitlement gating ─────────────────────────────────────────
  describe("broadcasts entitlement gating (entitlements)", () => {
    const spiceTenantRow = (extra: Record<string, unknown> = {}) => ({
      id: SPICE, plan: "starter", features: {}, grandfathered: false,
      status: "active", payment_status: "active", trial_ends_at: null, ...extra,
    });

    it("the whole system is dormant until the enforce_entitlements flag is on", async () => {
      tables["tenants"] = [spiceTenantRow()]; // starter plan does NOT include broadcasts
      const gate = await checkFeature(SPICE, "broadcasts");
      expect(gate).toEqual({ ok: true, enforcing: false, feature: "broadcasts", upgradeTo: null });
      expect(await hasFeature(SPICE, "broadcasts")).toBe(true);
    });

    it("when enforcing, the starter plan blocks broadcasts and suggests the cheapest ACTIVE plan that has it", async () => {
      mocks.getFlag.mockImplementation(async (k: string, d: boolean) => (k === "enforce_entitlements" ? true : d));
      tables["tenants"] = [spiceTenantRow()];

      const gate = await checkFeature(SPICE, "broadcasts");
      expect(gate.ok).toBe(false);
      expect(gate.enforcing).toBe(true);
      expect(gate.upgradeTo).toBe("growth"); // NOT the cheaper-but-retired "earlybird"
      expect(await hasFeature(SPICE, "broadcasts")).toBe(false);

      // A feature key the plan doesn't mention fails OPEN, even while enforcing.
      expect(await hasFeature(SPICE, "sequences")).toBe(true);
      // The platform owner's own workspace is never gated.
      expect((await checkFeature(DEFAULT_TENANT_ID, "broadcasts")).ok).toBe(true);
    });

    it("per-tenant overrides and grandfathering beat the plan default (incl. legacy override keys)", async () => {
      mocks.getFlag.mockImplementation(async (k: string, d: boolean) => (k === "enforce_entitlements" ? true : d));

      // Support flipped broadcasts on for this starter-plan restaurant.
      tables["tenants"] = [spiceTenantRow({ features: { broadcasts: true } })];
      expect((await checkFeature(SPICE, "broadcasts")).ok).toBe(true);

      // Legacy pre-0059 override key still maps: { instagram: false } → ch_instagram off.
      tables["tenants"] = [spiceTenantRow({ features: { instagram: false } })];
      expect(await hasFeature(SPICE, "ch_instagram")).toBe(false);

      // Grandfathered early customers keep everything, whatever the plan says.
      tables["tenants"] = [spiceTenantRow({ grandfathered: true })];
      const ent = await getEntitlements(SPICE);
      expect(ent.grandfathered).toBe(true);
      expect(ent.features.broadcasts).toBe(true);
    });

    it("a plans-table failure NEVER locks the restaurant out (fail-open)", async () => {
      mocks.getFlag.mockImplementation(async (k: string, d: boolean) => (k === "enforce_entitlements" ? true : d));
      tables["tenants"] = [spiceTenantRow()];
      mocks.getPlan.mockRejectedValue(new Error("wa_plans table missing"));

      const ent = await getEntitlements(SPICE);
      expect(ent.features.broadcasts).toBe(true); // all-on fallback
      expect((await checkFeature(SPICE, "broadcasts")).ok).toBe(true);
    });
  });
});
