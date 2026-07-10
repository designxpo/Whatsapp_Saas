// Travel agency industry scenario — backend contract suite.
//
// FEATURE CONTRACT this suite locks in, told as one agency's lead journey
// ("Wanderly Trips" sells Bali/Dubai/Europe packages over WhatsApp):
//
//  1. flowengine — a trip-planner ask-flow (welcome → destination buttons →
//     ask travellers (number-validated, retried) → ask month → tag →
//     personalized wrap-up) triggers on a keyword, runs per-tenant, and every
//     outbound line renders {{name}}/{{destination}}/{{travellers}} flow-vars
//     from the live contact. A "Talk to a travel expert" button routes into a
//     REAL handoff node: final message + conversation flagged "escalated" +
//     session closed.
//  2. llm.retrievalQuery + guard/grounding — "visa requirements" style
//     questions: a self-contained question retrieves on its own terms, an
//     anaphoric follow-up fuses with ONE prior turn; the GroundingFirewall
//     keeps KB-grounded visa specifics (fee, validity, link) verbatim but
//     defers invented fees/phones with an on-topic deferral, strips ungrounded
//     URLs and rewrites invented company-domain emails to the approved inbox.
//  3. sequences — the "bali offers" keyword drip: matchKeywordSequence is
//     case/trim/platform/tenant-scoped; enroll schedules the FIRST step's
//     delay and dedupes on (sequence_id, phone); drainSequences advances one
//     step per tick, schedules the next step from ITS delay, skips free-form
//     text outside the 24h window (recorded, never wedged) while templates
//     still send, and completes after the last step.
//  4. assistant + integrations — "talk to a human" escalates BEFORE any AI
//     layer and emitEvent("conversation.escalated") fans out a SIGNED envelope
//     to this tenant's webhook + a human-readable line to Slack (never to a
//     rival tenant); an AI that can't answer escalates too, carrying the reason.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub, global
// fetch is recorded (webhook endpoints use literal public IPs so the real SSRF
// guard passes without DNS), store/whatsapp/LLM layers are vi.fn boundaries.
// Zero network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const tables: Record<string, Record<string, any>[]> = {};
  const store = {
    appendConvMessage: vi.fn(),
    touchOutbound: vi.fn(),
    setConversationStatus: vi.fn(),
    setContactAttributes: vi.fn(),
    getContactByPhone: vi.fn(),
    claimReply: vi.fn(),
    setConversationAgent: vi.fn(),
    setConversationKbTag: vi.fn(),
    addContactTag: vi.fn(),
    takeArmedFlow: vi.fn(),
    updateContactProfile: vi.fn(),
    setConversationName: vi.fn(),
    setConversationLeadPhone: vi.fn(),
    upsertContacts: vi.fn(),
    landCapturedLead: vi.fn(),
    getConversationByPhone: vi.fn(),
    getConversation: vi.fn(),
    getConvHistory: vi.fn(),
    reflagReply: vi.fn(),
    isOptedOut: vi.fn(),
    dailySentCount: vi.fn(),
    getTenantSetting: vi.fn(),
    setTenantSetting: vi.fn(),
  };
  const wa = {
    sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), sendMedia: vi.fn(),
    sendProduct: vi.fn(), sendProductList: vi.fn(), sendCtaUrl: vi.fn(),
    sendCarouselTemplate: vi.fn(), sendTemplateSingle: vi.fn(), getCreds: vi.fn(),
  };
  const lsq = { syncLeadProfile: vi.fn(), pushWaActivity: vi.fn() };
  const within24h = vi.fn();
  const generateReply = vi.fn();
  const looksLikeCity = vi.fn();
  const routeMessage = vi.fn();
  const formresponses = { recordFormSent: vi.fn(), recordFormSubmitted: vi.fn(), markFormAbandoned: vi.fn() };
  return { tables, store, wa, lsq, within24h, generateReply, looksLikeCity, routeMessage, formresponses };
});

// ── Chainable, thenable Supabase stub. All ops apply lazily at await-time so
// `.update(p).eq(...)` filters correctly; delete/upsert really mutate the table.
vi.mock("@/lib/supabase", () => {
  type Row = Record<string, any>;
  const cmp = (a: any, b: any) => (typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? "")));
  function from(table: string) {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let conflict: string[] = [];
    const filters: ((r: Row) => boolean)[] = [];
    let sort: { col: string; asc: boolean } | null = null;
    let take: number | null = null;
    let single = false;
    const matches = () => (h.tables[table] ?? []).filter(r => filters.every(f => f(r)));
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return api; },
      neq: (c: string, v: any) => { filters.push(r => r[c] !== v); return api; },
      in: (c: string, vs: any[]) => { filters.push(r => vs.includes(r[c])); return api; },
      lte: (c: string, v: any) => { filters.push(r => cmp(r[c], v) <= 0); return api; },
      gte: (c: string, v: any) => { filters.push(r => cmp(r[c], v) >= 0); return api; },
      not: () => api,
      like: () => api,
      order: (c: string, o?: { ascending?: boolean }) => { sort = { col: c, asc: o?.ascending !== false }; return api; },
      limit: (n: number) => { take = n; return api; },
      single: () => { single = true; return api; },
      maybeSingle: () => { single = true; return api; },
      insert: (rows: Row | Row[]) => { op = "insert"; payload = [rows].flat(); return api; },
      upsert: (rows: Row | Row[], opts?: { onConflict?: string }) => {
        op = "upsert"; payload = [rows].flat();
        conflict = (opts?.onConflict ?? "").split(",").map(s => s.trim()).filter(Boolean);
        return api;
      },
      update: (p: Row) => { op = "update"; patch = p; return api; },
      delete: () => { op = "delete"; return api; },
      then: (resolve: (v: { data: any; error: null }) => any) => {
        const t = (h.tables[table] ??= []);
        let data: any = null;
        if (op === "insert") {
          t.push(...payload.map(r => ({ ...r })));
          data = single ? payload[0] : payload;
        } else if (op === "upsert") {
          for (const r of payload) {
            const hit = conflict.length ? t.find(x => conflict.every(k => x[k] === r[k])) : undefined;
            if (hit) Object.assign(hit, r); else t.push({ ...r });
          }
          data = single ? payload[0] : payload;
        } else if (op === "update") {
          const hit = matches();
          hit.forEach(r => Object.assign(r, patch));
          data = hit;
        } else if (op === "delete") {
          const del = new Set(matches());
          h.tables[table] = t.filter(r => !del.has(r));
        } else {
          let r = matches();
          if (sort) { const s = sort; r = [...r].sort((a, b) => cmp(a[s.col], b[s.col]) * (s.asc ? 1 : -1)); }
          if (take != null) r = r.slice(0, take);
          data = single ? r[0] ?? null : r;
        }
        return resolve({ data, error: null });
      },
    };
    return api;
  }
  return { db: () => ({ from }) };
});

vi.mock("@/lib/store", () => h.store);
vi.mock("@/lib/whatsapp", () => h.wa);
vi.mock("@/lib/instagram", () => ({
  sendIgMessage: vi.fn(async () => ({ ok: true, messageId: "ig_m" })),
  sendIgQuickReplies: vi.fn(async () => ({ ok: true, messageId: "ig_q" })),
  within24hWindow: h.within24h,
}));
vi.mock("@/lib/messenger", () => ({
  sendFbMessage: vi.fn(async () => ({ ok: true, messageId: "fb_m" })),
  sendFbMedia: vi.fn(async () => ({ ok: true, messageId: "fb_md" })),
  sendFbQuickReplies: vi.fn(async () => ({ ok: true, messageId: "fb_q" })),
}));
vi.mock("@/lib/channels", () => ({ getChannel: vi.fn(async () => null) }));
vi.mock("@/lib/formresponses", () => h.formresponses);
vi.mock("@/lib/leadsquared", () => h.lsq);
vi.mock("@/lib/commerce", () => ({ getProduct: vi.fn(async () => null) }));
vi.mock("@/lib/waforms", () => ({
  sendWaFormMessage: vi.fn(async () => ({ id: "wamid.form" })),
  getWaFormDef: vi.fn(async () => ({ title: "", fields: [] })),
  fieldSlug: (label: string, i: number) => `f${i}_${label.toLowerCase().replace(/\W+/g, "_")}`,
}));
vi.mock("@/lib/messaging-settings", () => ({
  isAiEnabled: vi.fn(async () => true),
  getFlowNudge: vi.fn(async () => null),
}));
// AI leaves: no SDK ever constructs, no model is ever called.
vi.mock("@/lib/ai/chat", () => ({ runChat: vi.fn(), providerSupportsMedia: () => true }));
vi.mock("@/lib/ai/keys", () => ({ resolveTenantAi: vi.fn(), AiKeyMissingError: class extends Error {} }));
vi.mock("@/lib/kb", () => ({
  retrieve: vi.fn(async () => []),
  embedQuery: vi.fn(async () => null),
  embedTexts: vi.fn(async () => []),
}));
vi.mock("@/lib/aihub", () => ({
  isAutoRouteEnabled: vi.fn(async () => false),
  pickAgentForQuery: vi.fn(async () => null),
  resolveAgent: vi.fn(async () => null),
  listFunctions: vi.fn(async () => []),
  executeAiFunction: vi.fn(),
  isToneEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/voice", () => ({
  getVoiceReplyMode: vi.fn(async () => "off"),
  shouldSpeak: vi.fn(() => false),
  synthesizeSpeech: vi.fn(async () => null),
  visionInlineMime: vi.fn(() => null),
  downloadRemoteMedia: vi.fn(async () => null),
}));
vi.mock("@/lib/router", () => ({ routeMessage: h.routeMessage, recordRagAnswer: vi.fn(async () => undefined) }));
vi.mock("@/lib/guard/audit", () => ({ auditReply: vi.fn(async () => undefined) }));
vi.mock("@/lib/quota", () => ({ getDailyCap: vi.fn(async () => 900) }));
// llm: retrievalQuery stays REAL (under test); the model-calling entry points
// are stubbed so the assistant pipeline runs offline.
vi.mock("@/lib/llm", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/llm")>();
  return { ...orig, generateReply: h.generateReply, looksLikeCity: h.looksLikeCity };
});
// NOTE: @/lib/integrations, @/lib/sequences, @/lib/guard/grounding and
// @/lib/ssrf stay REAL — the event fan-out, the drip engine and the firewall
// are under test; webhook URLs use literal public IPs so no DNS happens.

import {
  handleFlowMessage, drySender, fillVars,
  type FlowGraph, type FlowNode, type SimOutput,
} from "@/lib/flowengine";
import { retrievalQuery } from "@/lib/llm";
import { enforceGrounding } from "@/lib/guard/grounding";
import { matchKeywordSequence, enroll, drainSequences } from "@/lib/sequences";
import { respondToConversation } from "@/lib/assistant";
import { signPayload } from "@/lib/integrations";

const WANDERLY = "55555555-5555-5555-5555-5555555555aa";   // "Wanderly Trips" tenant
const RIVAL = "66666666-6666-6666-6666-6666666666bb";      // an unrelated agency
const TRAVELLER_PHONE = "919876504321";                    // digits-only, as stored
const CONV = "conv-travel-1";

// Recorded global-fetch traffic (webhook fan-out).
const fetchCalls: { url: string; method?: string; headers: Record<string, string>; body: string }[] = [];

function resetWorld() {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
  for (const group of [h.store, h.wa, h.lsq, h.formresponses]) {
    for (const fn of Object.values(group)) (fn as { mockReset(): void }).mockReset();
  }
  h.within24h.mockReset();
  h.generateReply.mockReset();
  h.looksLikeCity.mockReset();
  h.routeMessage.mockReset();
  // Defaults — individual tests override where the story needs it.
  h.store.appendConvMessage.mockResolvedValue({ id: "m1", createdAt: "2026-07-10T10:00:00.000Z" });
  h.store.getContactByPhone.mockResolvedValue(null);
  h.store.takeArmedFlow.mockResolvedValue(null);
  h.store.claimReply.mockResolvedValue(true);
  h.store.getConversationByPhone.mockResolvedValue(null);
  h.store.getConversation.mockResolvedValue(null);
  h.store.getConvHistory.mockResolvedValue([]);
  h.store.isOptedOut.mockResolvedValue(false);
  h.store.dailySentCount.mockResolvedValue(0);
  h.store.getTenantSetting.mockImplementation(async (_t: string, _k: string, fallback: unknown) => fallback);
  for (const k of [
    "touchOutbound", "setConversationStatus", "setContactAttributes", "setConversationAgent",
    "setConversationKbTag", "addContactTag", "updateContactProfile", "setConversationName",
    "setConversationLeadPhone", "upsertContacts", "landCapturedLead", "reflagReply", "setTenantSetting",
  ] as const) (h.store as any)[k].mockResolvedValue(undefined);
  for (const k of [
    "sendText", "sendButtons", "sendList", "sendMedia", "sendProduct",
    "sendProductList", "sendCtaUrl", "sendCarouselTemplate", "sendTemplateSingle",
  ] as const) (h.wa as any)[k].mockResolvedValue({ id: "wamid.test" });
  h.wa.getCreds.mockReturnValue({ token: "tok", phoneId: "ph1", wabaId: "waba1" });
  h.lsq.syncLeadProfile.mockResolvedValue(undefined);
  h.lsq.pushWaActivity.mockResolvedValue(undefined);
  h.within24h.mockReturnValue(true);
  h.looksLikeCity.mockResolvedValue(true);
  h.formresponses.recordFormSent.mockResolvedValue(undefined);
  h.formresponses.recordFormSubmitted.mockResolvedValue(undefined);
  h.formresponses.markFormAbandoned.mockResolvedValue(false);
  // Fetch recorder — every webhook delivery lands here instead of the network.
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: init?.method, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? init.body : "" });
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }), text: async () => "" } as unknown as Response;
  }));
}
beforeEach(resetWorld);
afterEach(() => vi.unstubAllGlobals());

// ── Fixtures ──────────────────────────────────────────────────────────────────
const node = (id: string, type: string, data: Record<string, unknown> = {}): FlowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data });

const DEST_MENU = [
  { id: "opt_bali", title: "Bali" },
  { id: "opt_dubai", title: "Dubai" },
  { id: "opt_expert", title: "Talk to a travel expert" },
];

// start → welcome → destination buttons (saved as {{destination}}) → ask
// travellers (number, retried) → ask month → tag "trip-qualified" →
// personalized wrap-up → end. "Talk to a travel expert" routes into a REAL
// handoff node (final message + escalate + close session).
const tripPlannerGraph: FlowGraph = {
  nodes: [
    node("start", "start"),
    node("welcome", "message", { text: "Namaste {{name}}! Welcome to Wanderly Trips ✈️ Beaches, deserts, mountains — we plan it all." }),
    node("menu", "buttons", { text: "Where are we headed next? 🌍", saveAs: "destination", buttons: DEST_MENU }),
    node("ask_pax", "ask", {
      question: "Lovely, {{name}} — {{destination}} it is! How many travellers should I plan for?",
      attribute: "travellers", validate: "number",
      retryText: "Just the number of travellers, please — e.g. 4.",
    }),
    node("ask_month", "ask", {
      question: "And which month are you planning the {{destination}} trip for?",
      attribute: "travel_month",
    }),
    node("tag_hot", "tag", { tag: "trip-qualified" }),
    node("wrap", "message", { text: "Perfect, {{name}}! I'll craft a {{destination}} itinerary for {{travellers}} travellers this {{travel_month}} and WhatsApp it right here. 🌴" }),
    node("expert", "handoff", { text: "No problem, {{name}} — a Wanderly travel expert will take it from here. 🧳" }),
    node("done", "end"),
  ],
  edges: [
    { id: "e1", source: "start", target: "welcome" },
    { id: "e2", source: "welcome", target: "menu" },
    { id: "e3", source: "menu", sourceHandle: "opt_bali", target: "ask_pax" },
    { id: "e4", source: "menu", sourceHandle: "opt_dubai", target: "ask_pax" },
    { id: "e5", source: "menu", sourceHandle: "opt_expert", target: "expert" },
    { id: "e6", source: "ask_pax", target: "ask_month" },
    { id: "e7", source: "ask_month", target: "tag_hot" },
    { id: "e8", source: "tag_hot", target: "wrap" },
    { id: "e9", source: "wrap", target: "done" },
  ],
};

const seedTripFlow = () => {
  h.tables["wa_flows"] = [{
    id: "flow-trip", tenant_id: WANDERLY, name: "Trip planner", active: true,
    trigger_keywords: ["trip", "hi"], platform: "whatsapp", channel_id: null,
    primary_kb_tag: "trips", graph: tripPlannerGraph,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  }];
};

// A live contact whose `attributes` merge exactly like the real store, so
// {{destination}}/{{travellers}} resolve mid-flow.
const liveContact = () => {
  const contact: any = { id: "c-priya", phone: TRAVELLER_PHONE, name: "Priya Nair", email: null, tags: [], attributes: {} };
  h.store.getContactByPhone.mockImplementation(async () => contact);
  h.store.setContactAttributes.mockImplementation(async (_p: string, attrs: Record<string, string>) => {
    contact.attributes = { ...contact.attributes, ...attrs };
  });
  return contact;
};

const menuSession = () => {
  h.tables["wa_flow_sessions"] = [{
    tenant_id: WANDERLY, conversation_id: CONV, flow_id: "flow-trip",
    current_node: "menu", state: {}, updated_at: new Date().toISOString(),
  }];
};

describe("Travel agency (Wanderly Trips)", () => {

  describe("trip-planner ask flow (flowengine + {{flow-vars}})", () => {
    it('the "trip" keyword starts planning: personalized welcome, then the destination menu (dry-run)', async () => {
      seedTripFlow();
      liveContact();
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "Trip", { sender: drySender(out), tenantId: WANDERLY })).toBe(true);
      expect(out.map(o => o.kind)).toEqual(["text", "buttons"]);
      // {{name}} rendered to the FIRST name already on the very first bubble.
      expect(out[0].body).toBe("Namaste Priya! Welcome to Wanderly Trips ✈️ Beaches, deserts, mountains — we plan it all.");
      expect(out[1].options).toEqual(["Bali", "Dubai", "Talk to a travel expert"]);
      // The session parked on the menu node, under THIS tenant.
      expect(h.tables["wa_flow_sessions"]).toHaveLength(1);
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({
        conversation_id: CONV, flow_id: "flow-trip", current_node: "menu", tenant_id: WANDERLY,
      });
    });

    it("the same keyword under a rival agency's tenant does not start Wanderly's flow", async () => {
      seedTripFlow();   // the flow belongs to WANDERLY only
      const out: SimOutput[] = [];
      expect(await handleFlowMessage("conv-rival", TRAVELLER_PHONE, "trip", { sender: drySender(out), tenantId: RIVAL })).toBe(false);
      expect(out).toHaveLength(0);
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it("qualifies a traveller end-to-end: destination saved, travellers retried then captured, month captured, tagged, wrap-up fully personalized", async () => {
      seedTripFlow();
      liveContact();

      // 1. "trip" → welcome + destination menu; chat AI scoped to the trips KB tag.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "trip", { tenantId: WANDERLY })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(TRAVELLER_PHONE, "Namaste Priya! Welcome to Wanderly Trips ✈️ Beaches, deserts, mountains — we plan it all.", undefined);
      expect(h.wa.sendButtons).toHaveBeenCalledWith(TRAVELLER_PHONE, "Where are we headed next? 🌍", DEST_MENU, undefined);
      expect(h.store.setConversationKbTag).toHaveBeenCalledWith(CONV, "trips");
      expect(h.store.claimReply).toHaveBeenCalledWith(CONV);

      // 2. Button tap → destination saved; the NEXT question already renders
      //    {{name}} AND the just-captured {{destination}}.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "Bali", { tenantId: WANDERLY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(TRAVELLER_PHONE, { destination: "Bali" }, WANDERLY);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("Lovely, Priya — Bali it is! How many travellers should I plan for?");

      // 3. A worded count fails number validation → retried, never stored.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "a family of four", { tenantId: WANDERLY })).toBe(true);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1)).toBe("Just the number of travellers, please — e.g. 4.");
      expect(h.store.setContactAttributes).not.toHaveBeenCalledWith(TRAVELLER_PHONE, expect.objectContaining({ travellers: expect.anything() }), WANDERLY);
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({ current_node: "ask_pax", state: { menu: "menu", tries: 1 } });

      // 4. "4" passes → stored; the month question renders the destination again.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "4", { tenantId: WANDERLY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(TRAVELLER_PHONE, { travellers: "4" }, WANDERLY);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("And which month are you planning the Bali trip for?");

      // 5. Month lands → tagged, wrap-up renders EVERY flow var, session closed.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "December", { tenantId: WANDERLY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(TRAVELLER_PHONE, { travel_month: "December" }, WANDERLY);
      expect(h.store.addContactTag).toHaveBeenCalledWith(TRAVELLER_PHONE, "trip-qualified", WANDERLY);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("Perfect, Priya! I'll craft a Bali itinerary for 4 travellers this December and WhatsApp it right here. 🌴");
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
      // …so the next off-script message falls through to the AI.
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "can you also add Nusa Penida?", { tenantId: WANDERLY })).toBe(false);
    });

    it('"Talk to a travel expert" runs the REAL handoff node: personalized hand-off line, chat escalated, session closed', async () => {
      seedTripFlow();
      liveContact();
      menuSession();
      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "Talk to a travel expert", { tenantId: WANDERLY })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(TRAVELLER_PHONE, "No problem, Priya — a Wanderly travel expert will take it from here. 🧳", undefined);
      expect(h.store.setConversationStatus).toHaveBeenCalledWith(CONV, "escalated");
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it("a digit answer 1..N to a number-validated ask is stored as the answer, never hijacked by the old-menu rewind", async () => {
      // "How many travellers?" (number-validated) follows a 3-option menu, and
      // matchOption maps any digit ≤ the menu size to a pick — but a reply that
      // passes the waiting ask's validation IS the answer, so the rewind must
      // not steal it. Replying "2" stores travellers=2 and the flow advances.
      seedTripFlow();
      const contact = liveContact();
      contact.attributes = { destination: "Bali" };
      h.tables["wa_flow_sessions"] = [{
        tenant_id: WANDERLY, conversation_id: CONV, flow_id: "flow-trip",
        current_node: "ask_pax", state: { menu: "menu" }, updated_at: new Date().toISOString(),
      }];

      expect(await handleFlowMessage(CONV, TRAVELLER_PHONE, "2", { tenantId: WANDERLY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(TRAVELLER_PHONE, { travellers: "2" }, WANDERLY);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("And which month are you planning the Bali trip for?");
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({ current_node: "ask_month" });
    });

    it("fillVars personalizes from the contact and never leaks raw {{tokens}} (pure)", () => {
      const c = {
        name: "Priya Nair", phone: TRAVELLER_PHONE, email: null,
        attributes: { destination: "Bali", travellers: "4" },
      };
      expect(fillVars("Hey {{name}}, your {{Destination}} trip for {{travellers}} pax is on!", c))
        .toBe("Hey Priya, your Bali trip for 4 pax is on!");        // first name + case-insensitive attrs
      expect(fillVars("Visa checklist for {{destination}}: {{visa_link}}", c))
        .toBe("Visa checklist for Bali: ");                          // unknown → "", never a raw token
    });
  });

  describe('"visa requirements" questions: retrieval query + grounding firewall', () => {
    const KB_CONTEXT = [
      "Wanderly KB — Bali visa guide for Indian passport holders:",
      "Visa on Arrival costs ₹3,500 per person and is valid for 30 days.",
      "Carry a passport valid for 6 months. Full checklist: wanderly.com/visa",
      "Questions? Write to visas@wanderly.com or call +91 98200 44556.",
    ].join("\n");

    it("a self-contained visa question retrieves on its own terms (no topic drift)", () => {
      const history = [
        { role: "user" as const, body: "Tell me about the Maldives honeymoon package" },
        { role: "assistant" as const, body: "It's 4N/5D at an overwater villa…" },
        { role: "user" as const, body: "Do I need a visa for Bali?" },
      ];
      // Short but self-subjected — must NOT fuse with the Maldives turn.
      expect(retrievalQuery(history)).toBe("Do I need a visa for Bali?");
    });

    it("anaphoric follow-ups fuse with exactly ONE prior user turn", () => {
      // "and …" opener → leans on the visa question for its subject.
      expect(retrievalQuery([
        { role: "user", body: "Do I need a visa for Bali?" },
        { role: "assistant", body: "Yes — Visa on Arrival…" },
        { role: "user", body: "and the requirements?" },
      ])).toBe("Do I need a visa for Bali? and the requirements?");
      // Bare aspect word → same fusion.
      expect(retrievalQuery([
        { role: "user", body: "Tell me about the Maldives honeymoon package" },
        { role: "assistant", body: "…" },
        { role: "user", body: "fees?" },
      ])).toBe("Tell me about the Maldives honeymoon package fees?");
      // Only the SINGLE prior user turn is used, never two.
      expect(retrievalQuery([
        { role: "user", body: "Bali trip" },
        { role: "assistant", body: "…" },
        { role: "user", body: "Dubai desert safari details" },
        { role: "assistant", body: "…" },
        { role: "user", body: "what about visa" },
      ])).toBe("Dubai desert safari details what about visa");
    });

    it("KB-grounded visa specifics (fee, validity, link) pass through verbatim", () => {
      const reply = "Indian passport holders get a Visa on Arrival for ₹3,500, valid for 30 days. Full checklist: wanderly.com/visa";
      const r = enforceGrounding(reply, KB_CONTEXT, { questionHint: "Bali visa requirements?" });
      expect(r.text).toBe(reply);
      expect(r.actions).toEqual([]);
    });

    it("an invented visa fee and phone number are deferred — grounded sentence leads, ONE on-topic deferral trails", () => {
      const reply = "Bali offers Visa on Arrival for Indian passport holders. The visa costs ₹9,999 and must be paid in cash. You can also call our Bali desk on +91 99999 88888.";
      const r = enforceGrounding(reply, KB_CONTEXT, { questionHint: "How much is the Bali visa fee?" });
      expect(r.text).toBe(
        "Bali offers Visa on Arrival for Indian passport holders. For the exact fees, our team will share the latest confirmed information.",
      );
      expect(r.text).not.toContain("9,999");
      expect(r.text).not.toContain("99999 88888");
      expect(r.actions.map(a => [a.cls, a.disposition])).toEqual([
        ["CURRENCY", "defer"],
        ["PHONE", "defer"],
      ]);
    });

    it("an ungrounded link is stripped and an invented company-domain email is rewritten to the approved inbox", () => {
      const reply = "You can fast-track at visa-rush.io or email bali-team@wanderly.com.";
      const r = enforceGrounding(reply, KB_CONTEXT, { approvedEmail: "visas@wanderly.com" });
      expect(r.text).toBe("You can fast-track at or email visas@wanderly.com.");
      expect(r.actions).toEqual([
        { cls: "EMAIL", original: "bali-team@wanderly.com", disposition: "rewrite", replacement: "visas@wanderly.com" },
        { cls: "URL", original: "visa-rush.io", disposition: "strip" },
      ]);
    });
  });

  describe('the "bali offers" drip (sequences: enroll → step scheduling)', () => {
    const seedDrip = () => {
      h.tables["wa_sequences"] = [
        { id: "seq-bali", tenant_id: WANDERLY, name: "Bali deal drip", platform: "whatsapp",
          trigger_kind: "keyword", trigger_value: "bali offers", active: true, channel_id: null,
          created_at: "2026-07-01T00:00:00.000Z" },
        { id: "seq-rival", tenant_id: RIVAL, name: "Rival's drip", platform: "whatsapp",
          trigger_kind: "keyword", trigger_value: "bali offers", active: true, channel_id: null,
          created_at: "2026-07-01T00:00:01.000Z" },
      ];
      h.tables["wa_sequence_steps"] = [
        { id: "st-0", tenant_id: WANDERLY, sequence_id: "seq-bali", step_index: 0, delay_minutes: 0,
          action: { type: "text", text: "Today's Bali deal 🌴 5N/6D from ₹52,999 — flights + villa included." } },
        { id: "st-1", tenant_id: WANDERLY, sequence_id: "seq-bali", step_index: 1, delay_minutes: 2880,
          action: { type: "text", text: "Seats on the Bali group departure are filling fast — shall I hold one for you?" } },
        { id: "st-2", tenant_id: WANDERLY, sequence_id: "seq-bali", step_index: 2, delay_minutes: 4320,
          action: { type: "template", templateName: "bali_final_call", languageCode: "en", params: ["Priya"] } },
      ];
    };

    it("matchKeywordSequence is case/trim-insensitive, exact-word, platform- and tenant-scoped", async () => {
      seedDrip();
      const mine = await matchKeywordSequence("whatsapp", "  Bali Offers ", WANDERLY);
      expect(mine?.id).toBe("seq-bali");
      expect(mine?.tenantId).toBe(WANDERLY);
      // A rival tenant resolves to their OWN drip, never Wanderly's.
      expect((await matchKeywordSequence("whatsapp", "bali offers", RIVAL))?.id).toBe("seq-rival");
      // Wrong platform → no match (an IG DM must not start a WhatsApp drip).
      expect(await matchKeywordSequence("instagram", "bali offers", WANDERLY)).toBeNull();
      // Partial text is not the trigger word.
      expect(await matchKeywordSequence("whatsapp", "bali", WANDERLY)).toBeNull();
    });

    it("enroll schedules the FIRST step's delay, dedupes on (sequence, phone), and no-ops on an empty sequence", async () => {
      seedDrip();
      // First step has delay 0 → due immediately.
      await enroll("seq-bali", { phone: TRAVELLER_PHONE, conversationId: CONV }, WANDERLY);
      expect(h.tables["wa_sequence_enrollments"]).toHaveLength(1);
      const row = h.tables["wa_sequence_enrollments"][0];
      expect(row).toMatchObject({
        tenant_id: WANDERLY, sequence_id: "seq-bali", phone: TRAVELLER_PHONE,
        platform: "whatsapp", conversation_id: CONV, current_step: 0, status: "active",
      });
      expect(Math.abs(Date.parse(row.next_run_at) - Date.now())).toBeLessThan(5000);

      // Re-triggering the keyword doesn't double-enroll the same person.
      await enroll("seq-bali", { phone: TRAVELLER_PHONE, conversationId: CONV }, WANDERLY);
      expect(h.tables["wa_sequence_enrollments"]).toHaveLength(1);

      // A drip whose first nudge waits a day schedules next_run_at a day out.
      h.tables["wa_sequence_steps"].push({
        id: "st-p0", tenant_id: WANDERLY, sequence_id: "seq-precheck", step_index: 0, delay_minutes: 1440,
        action: { type: "text", text: "Your Bali pre-departure checklist 📋 passport, visa, forex." },
      });
      await enroll("seq-precheck", { phone: TRAVELLER_PHONE }, WANDERLY);
      const pre = h.tables["wa_sequence_enrollments"].find(r => r.sequence_id === "seq-precheck")!;
      expect(Math.abs(Date.parse(pre.next_run_at) - (Date.now() + 1440 * 60_000))).toBeLessThan(5000);

      // No steps configured → nothing to run → no enrollment row at all.
      await enroll("seq-empty", { phone: TRAVELLER_PHONE }, WANDERLY);
      expect(h.tables["wa_sequence_enrollments"].some(r => r.sequence_id === "seq-empty")).toBe(false);
    });

    it("drainSequences sends the due step inside the 24h window and schedules the NEXT step from its own delay", async () => {
      seedDrip();
      h.tables["wa_sequence_enrollments"] = [{
        id: "enr-1", tenant_id: WANDERLY, sequence_id: "seq-bali", phone: TRAVELLER_PHONE,
        platform: "whatsapp", conversation_id: CONV, current_step: 0, status: "active",
        next_run_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z",
      }];
      h.store.getConversationByPhone.mockResolvedValue({ lastInboundAt: new Date().toISOString() });
      h.within24h.mockReturnValue(true);

      expect(await drainSequences(50, WANDERLY)).toBe(1);
      expect(h.wa.sendText).toHaveBeenCalledWith(TRAVELLER_PHONE, "Today's Bali deal 🌴 5N/6D from ₹52,999 — flights + villa included.", undefined);
      const row = h.tables["wa_sequence_enrollments"][0];
      expect(row).toMatchObject({ current_step: 1, status: "active", last_error: null });
      // Step 1 waits 2880 minutes (2 days) measured from NOW.
      expect(Math.abs(Date.parse(row.next_run_at) - (Date.now() + 2880 * 60_000))).toBeLessThan(5000);
    });

    it("outside the 24h window a free-form step is SKIPPED (recorded, still advances) but the approved template still sends and completes the drip", async () => {
      seedDrip();
      h.tables["wa_sequence_enrollments"] = [{
        id: "enr-1", tenant_id: WANDERLY, sequence_id: "seq-bali", phone: TRAVELLER_PHONE,
        platform: "whatsapp", conversation_id: CONV, current_step: 1, status: "active",
        next_run_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z",
      }];
      // The lead last wrote 3 days ago — the session window is closed.
      h.store.getConversationByPhone.mockResolvedValue({ lastInboundAt: "2026-07-07T00:00:00.000Z" });
      h.within24h.mockReturnValue(false);

      // Step 1 (free-form text) must NOT go out — a closed-window send is a ban trigger.
      expect(await drainSequences(50, WANDERLY)).toBe(1);
      expect(h.wa.sendText).not.toHaveBeenCalled();
      const row = h.tables["wa_sequence_enrollments"][0];
      expect(row.current_step).toBe(2);                       // skipped, never wedged
      expect(row.last_error).toMatch(/outside 24h window.*approved template/i);

      // Step 2 is a Meta-approved template — those need no window. Make it due again.
      row.next_run_at = "2026-07-10T00:00:00.000Z";
      expect(await drainSequences(50, WANDERLY)).toBe(1);
      expect(h.wa.sendTemplateSingle).toHaveBeenCalledWith(TRAVELLER_PHONE, "bali_final_call", "en", ["Priya"], undefined);
      expect(h.wa.sendText).not.toHaveBeenCalled();
      // Last step done → the enrollment completes cleanly.
      expect(h.tables["wa_sequence_enrollments"][0]).toMatchObject({ status: "completed", last_error: null });
    });
  });

  describe('human handoff → emitEvent("conversation.escalated") (assistant + integrations)', () => {
    // Literal public IPs: the REAL SSRF guard passes them without a DNS lookup,
    // so the delivery path runs end-to-end against the recorded fetch stub.
    const OPS_HOOK_URL = "https://203.0.113.60/zapier/hooks/wanderly-escalations";
    const SLACK_URL = "https://203.0.113.61/services/T0WAND/B0OPS/xyz";
    const RIVAL_URL = "https://203.0.113.62/rival/hook";
    const SIGNING_SECRET = "wanderly_signing_secret_2026";   // stored plaintext = legacy path of readSecret
    const CONV2 = "conv-travel-2";

    const seedEscalationWiring = () => {
      h.tables["wa_integrations"] = [
        { id: "int-ops", tenant_id: WANDERLY, kind: "webhook", name: "Ops escalation hook", active: true,
          config: { url: OPS_HOOK_URL, format: "generic" }, events: ["conversation.escalated"],
          status: "unverified", status_detail: null, secret: SIGNING_SECRET, last_event_at: null, created_at: "2026-07-01T00:00:00.000Z" },
        { id: "int-slack", tenant_id: WANDERLY, kind: "slack", name: "#travel-desk", active: true,
          config: { url: SLACK_URL, format: "slack" }, events: ["conversation.escalated"],
          status: "unverified", status_detail: null, secret: null, last_event_at: null, created_at: "2026-07-01T00:00:01.000Z" },
        { id: "int-rival", tenant_id: RIVAL, kind: "webhook", name: "Rival hook", active: true,
          config: { url: RIVAL_URL, format: "generic" }, events: ["conversation.escalated"],
          status: "unverified", status_detail: null, secret: null, last_event_at: null, created_at: "2026-07-01T00:00:02.000Z" },
      ];
    };

    const seedConversation = (lastUserMessage: string) => {
      h.store.getConversation.mockResolvedValue({
        id: CONV2, phone: TRAVELLER_PHONE, name: "Priya Nair", tenantId: WANDERLY,
        botEnabled: true, status: "active", platform: "whatsapp",
        channelId: null, agentId: null, primaryKbTag: null,
        lastInboundAt: new Date().toISOString(),
      });
      h.store.getConvHistory.mockResolvedValue([
        { role: "user", body: "Do you do Bali honeymoon packages?" },
        { role: "assistant", body: "We do! 5N/6D options start with a private villa…" },
        { role: "user", body: lastUserMessage },
      ]);
    };

    it('"I want to talk to a human agent" escalates BEFORE any AI layer and fans the signed event out to THIS tenant only', async () => {
      seedEscalationWiring();
      seedConversation("I want to talk to a human agent please");

      const res = await respondToConversation(CONV2);
      expect(res).toEqual({ outcome: "escalated", detail: "human requested" });
      expect(h.store.setConversationStatus).toHaveBeenCalledWith(CONV2, "escalated");
      // Routed straight to a person — the FAQ/cache/RAG layers never ran.
      expect(h.routeMessage).not.toHaveBeenCalled();
      expect(h.generateReply).not.toHaveBeenCalled();
      // The customer still got an immediate hand-off reply.
      expect(h.wa.sendText).toHaveBeenCalledWith(
        TRAVELLER_PHONE,
        "I've flagged this for our team — someone will follow up with you here. In the meantime, I'm happy to keep helping with any questions! 🙌",
        undefined,
      );

      // emitEvent is fire-and-forget — wait for both deliveries to land.
      await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));
      expect(fetchCalls.map(c => c.url).sort()).toEqual([OPS_HOOK_URL, SLACK_URL].sort());   // never the rival's endpoint

      const hook = fetchCalls.find(c => c.url === OPS_HOOK_URL)!;
      expect(hook.method).toBe("POST");
      const envelope = JSON.parse(hook.body);
      expect(envelope).toMatchObject({
        event: "conversation.escalated",
        tenant: WANDERLY,
        data: { conversationId: CONV2, phone: TRAVELLER_PHONE, name: "Priya Nair", reason: "human requested", channel: "whatsapp" },
      });
      expect(hook.headers["X-Alabs-Event"]).toBe("conversation.escalated");
      // The receiver can verify authenticity: HMAC over the EXACT raw body.
      expect(hook.headers["X-Alabs-Signature"]).toBe(signPayload(SIGNING_SECRET, hook.body));

      const slack = fetchCalls.find(c => c.url === SLACK_URL)!;
      expect(JSON.parse(slack.body)).toEqual({ text: "🙋 Chat with Priya Nair needs a human — human requested." });
      expect(slack.headers["X-Alabs-Signature"]).toBeUndefined();   // Slack gets no signature

      // Both of Wanderly's rows got a heartbeat; the rival row stayed untouched.
      const rows = h.tables["wa_integrations"];
      expect(rows.find(r => r.id === "int-ops")).toMatchObject({ status: "connected" });
      expect(rows.find(r => r.id === "int-ops")!.last_event_at).toBeTruthy();
      expect(rows.find(r => r.id === "int-rival")).toMatchObject({ status: "unverified", last_event_at: null });
    });

    it("when the AI has nothing safe to answer it escalates too, and the event carries the reason", async () => {
      seedEscalationWiring();
      seedConversation("Can you build a fully custom 12-day Europe itinerary for my parents?");
      h.routeMessage.mockResolvedValue({ answer: null, queryEmbedding: null, source: "none" });
      h.generateReply.mockResolvedValue({ reply: null, escalate: true, reason: "KB has nothing on custom Europe itineraries", usedChunks: 0 });

      const res = await respondToConversation(CONV2);
      expect(res).toEqual({ outcome: "escalated", detail: "KB has nothing on custom Europe itineraries" });
      // The reply was composed with THIS tenant's context.
      expect(h.generateReply).toHaveBeenCalledWith(expect.anything(), TRAVELLER_PHONE, null, WANDERLY, null);
      expect(h.store.setConversationStatus).toHaveBeenCalledWith(CONV2, "escalated");
      // The customer gets the default hand-off line, not silence.
      expect(h.wa.sendText).toHaveBeenCalledWith(
        TRAVELLER_PHONE,
        "Thanks for reaching out — I've flagged this for our team to follow up. Meanwhile, I'm happy to keep helping — what would you like to know?",
        undefined,
      );

      await vi.waitFor(() => expect(fetchCalls).toHaveLength(2));
      const envelope = JSON.parse(fetchCalls.find(c => c.url === OPS_HOOK_URL)!.body);
      expect(envelope.event).toBe("conversation.escalated");
      expect(envelope.data.reason).toBe("KB has nothing on custom Europe itineraries");
    });
  });
});
