// Real estate agency industry scenario — backend contract suite.
//
// FEATURE CONTRACT this suite locks in, told as one agency's lead journey
// ("Skyline Realty" sells + rents Mumbai homes over WhatsApp; leads arrive from
// hoarding QR codes and portal ads):
//
//  1. flowengine — a buyer-qualification ask-flow (welcome → intent buttons →
//     ask budget (number-validated) → ask locality (city-validated) → tag →
//     personalized wrap-up) triggers on a keyword, runs per-tenant, captures
//     budget/city as contact attributes, and {{name}}/{{budget}}/{{city}}
//     flow-vars personalize every outbound line. Off-script questions bail out
//     to the AI; an unconnected "Talk to an agent" button escalates to a human.
//  2. integrations — emitEvent("contact.created" / "message.inbound") fans out
//     ONLY to this tenant's active, subscribed connections: the generic webhook
//     gets the full signed envelope (HMAC verifiable with signPayload), Slack
//     gets the one-line humanText. A broken endpoint is isolated and recorded
//     on its own row; emitEvent never throws. Secrets are stored encrypted.
//  3. handlehub — every QR/hoarding gets a tracked wa.me link embedding
//     "[ref:CODE]"; on the first inbound parseRef/stripRef recover the source
//     and the human text, resolveRef is tenant-scoped, recordTouch bumps the
//     counter and never throws.
//  4. pipeline — dragging a lead into "Site visit scheduled" is tenant-scoped
//     (a rival's stage id is rejected) and applyStageEffects fires the stage
//     automations: auto-tag, a REAL sequence enrollment (via lib/sequences
//     against the stubbed db), and the mapped LeadSquared stage push — each
//     only when configured.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub, global
// fetch is recorded (webhook endpoints use literal public IPs so the real SSRF
// guard passes without DNS), store/whatsapp/LSQ layers are vi.fn boundaries.
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
    getTenantSetting: vi.fn(),
    setTenantSetting: vi.fn(),
  };
  const wa = {
    sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), sendMedia: vi.fn(),
    sendProduct: vi.fn(), sendProductList: vi.fn(), sendCtaUrl: vi.fn(),
    sendCarouselTemplate: vi.fn(), sendTemplateSingle: vi.fn(), getCreds: vi.fn(),
  };
  const lsq = {
    syncLeadProfile: vi.fn(),
    getLeadIdByPhone: vi.fn(),
    updateLeadStage: vi.fn(),
    lsqConfigured: vi.fn(),
  };
  const looksLikeCity = vi.fn();
  const formresponses = { recordFormSent: vi.fn(), recordFormSubmitted: vi.fn(), markFormAbandoned: vi.fn() };
  return { tables, store, wa, lsq, looksLikeCity, formresponses };
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
  within24hWindow: vi.fn(() => true),
}));
vi.mock("@/lib/messenger", () => ({
  sendFbMessage: vi.fn(async () => ({ ok: true, messageId: "fb_m" })),
  sendFbMedia: vi.fn(async () => ({ ok: true, messageId: "fb_md" })),
  sendFbQuickReplies: vi.fn(async () => ({ ok: true, messageId: "fb_q" })),
}));
vi.mock("@/lib/channels", () => ({ getChannel: vi.fn(async () => null) }));
vi.mock("@/lib/formresponses", () => h.formresponses);
vi.mock("@/lib/leadsquared", () => h.lsq);
vi.mock("@/lib/llm", () => ({ looksLikeCity: h.looksLikeCity }));
vi.mock("@/lib/commerce", () => ({ getProduct: vi.fn(async () => null) }));
// waforms: keep the PURE builders/sluggers real; stub only the Graph API calls.
vi.mock("@/lib/waforms", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/waforms")>();
  return { ...orig, getWaFormDef: vi.fn(async () => ({ title: "", fields: [] })), sendWaFormMessage: vi.fn(async () => ({ id: "wamid.form" })) };
});
// NOTE: @/lib/integrations and @/lib/ssrf stay REAL — the fan-out and the SSRF
// guard are under test; webhook URLs use literal public IPs so no DNS happens.

import {
  handleFlowMessage, drySender, looseIndex, matchOption, fillVars,
  type FlowGraph, type FlowNode, type SimOutput,
} from "@/lib/flowengine";
import { emitEvent, createIntegration, signPayload, humanText } from "@/lib/integrations";
import { getHandleHubConfig, trackedLink, parseRef, stripRef, resolveRef, recordTouch } from "@/lib/handlehub";
import { moveContact, applyStageEffects, listStages } from "@/lib/pipeline";
import { readSecret } from "@/lib/crypto";

const SKYLINE = "33333333-3333-3333-3333-3333333333aa";   // "Skyline Realty" tenant
const RIVAL = "44444444-4444-4444-4444-4444444444bb";     // an unrelated agency
const BUYER_PHONE = "919820011223";                       // digits-only, as stored
const CONV = "conv-realestate-1";

// Recorded global-fetch traffic (webhook fan-out) + endpoints forced to fail.
const fetchCalls: { url: string; method?: string; headers: Record<string, string>; body: string }[] = [];
const fetchFail = new Set<string>();

function resetWorld() {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
  for (const group of [h.store, h.wa, h.lsq, h.formresponses]) {
    for (const fn of Object.values(group)) (fn as { mockReset(): void }).mockReset();
  }
  h.looksLikeCity.mockReset();
  // Defaults — individual tests override where the story needs it.
  h.store.appendConvMessage.mockResolvedValue({ id: "m1", createdAt: "2026-07-05T10:00:00.000Z" });
  h.store.getContactByPhone.mockResolvedValue(null);
  h.store.takeArmedFlow.mockResolvedValue(null);
  h.store.claimReply.mockResolvedValue(true);
  h.store.getConversationByPhone.mockResolvedValue(null);
  h.store.getTenantSetting.mockImplementation(async (_t: string, _k: string, fallback: unknown) => fallback);
  for (const k of [
    "touchOutbound", "setConversationStatus", "setContactAttributes", "setConversationAgent",
    "setConversationKbTag", "addContactTag", "updateContactProfile", "setConversationName",
    "setConversationLeadPhone", "upsertContacts", "landCapturedLead", "setTenantSetting",
  ] as const) (h.store as any)[k].mockResolvedValue(undefined);
  for (const k of [
    "sendText", "sendButtons", "sendList", "sendMedia", "sendProduct",
    "sendProductList", "sendCtaUrl", "sendCarouselTemplate", "sendTemplateSingle",
  ] as const) (h.wa as any)[k].mockResolvedValue({ id: "wamid.test" });
  h.wa.getCreds.mockReturnValue({ token: "tok", phoneId: "ph1", wabaId: "waba1" });
  h.lsq.syncLeadProfile.mockResolvedValue(undefined);
  h.lsq.lsqConfigured.mockResolvedValue(false);
  h.lsq.getLeadIdByPhone.mockResolvedValue(null);
  h.lsq.updateLeadStage.mockResolvedValue(true);
  h.looksLikeCity.mockResolvedValue(true);
  h.formresponses.recordFormSent.mockResolvedValue(undefined);
  h.formresponses.recordFormSubmitted.mockResolvedValue(undefined);
  h.formresponses.markFormAbandoned.mockResolvedValue(false);
  // Fetch recorder — every webhook delivery lands here instead of the network.
  fetchCalls.length = 0;
  fetchFail.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: init?.method, headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? init.body : "" });
    const fail = [...fetchFail].some(s => u.includes(s));
    return { ok: !fail, status: fail ? 500 : 200, headers: new Headers(), json: async () => ({ ok: true }), text: async () => "" } as unknown as Response;
  }));
}
beforeEach(resetWorld);
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SECRET_ENC_KEY; });

// ── Fixtures ──────────────────────────────────────────────────────────────────
const node = (id: string, type: string, data: Record<string, unknown> = {}): FlowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data });

const INTENT_MENU = [
  { id: "opt_buy", title: "Buy a home" },
  { id: "opt_rent", title: "Rent a home" },
  { id: "opt_agent", title: "Talk to an agent" },
];

// start → welcome → intent buttons (saved as {{intent}}) → ask budget (number,
// retried) → ask locality (city, personalized with the captured budget) →
// tag "qualified-buyer" → personalized wrap-up → end. The rent branch answers
// and ends; the "Talk to an agent" option is deliberately left UNCONNECTED so
// the engine's escalation safety-net owns it.
const qualifierGraph: FlowGraph = {
  nodes: [
    node("start", "start"),
    node("welcome", "message", { text: "Welcome to Skyline Realty! 🏙 Zero spam — just homes." }),
    node("menu", "buttons", { text: "What brings you to Skyline today?", saveAs: "intent", buttons: INTENT_MENU }),
    node("ask_budget", "ask", {
      question: "What's your budget for the purchase? A number works best — e.g. 7500000.",
      attribute: "budget", validate: "number",
      retryText: "Just the number, please — e.g. 7500000 or 75,00,000.",
    }),
    node("ask_city", "ask", {
      question: "Got it, {{name}} — around ₹{{budget}}. Which locality are you house-hunting in?",
      attribute: "city", validate: "city",
    }),
    node("tag_hot", "tag", { tag: "qualified-buyer" }),
    node("wrap", "message", { text: "Perfect, {{name}}! I'll line up 2-3 BHK options in {{city}} within ₹{{budget}} and WhatsApp you a shortlist today." }),
    node("rent", "message", { text: "We do rentals too — our rentals desk will send today's listings shortly." }),
    node("done", "end"),
    node("rent_done", "end"),
  ],
  edges: [
    { id: "e1", source: "start", target: "welcome" },
    { id: "e2", source: "welcome", target: "menu" },
    { id: "e3", source: "menu", sourceHandle: "opt_buy", target: "ask_budget" },
    { id: "e4", source: "menu", sourceHandle: "opt_rent", target: "rent" },
    // opt_agent: NO edge on purpose — must auto-escalate, not dead-end.
    { id: "e5", source: "ask_budget", target: "ask_city" },
    { id: "e6", source: "ask_city", target: "tag_hot" },
    { id: "e7", source: "tag_hot", target: "wrap" },
    { id: "e8", source: "wrap", target: "done" },
    { id: "e9", source: "rent", target: "rent_done" },
  ],
};

const seedQualifierFlow = () => {
  h.tables["wa_flows"] = [{
    id: "flow-qualify", tenant_id: SKYLINE, name: "Buyer qualification", active: true,
    trigger_keywords: ["hi", "property"], platform: "whatsapp", channel_id: null,
    primary_kb_tag: "listings", graph: qualifierGraph,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  }];
};

const menuSession = () => {
  h.tables["wa_flow_sessions"] = [{
    tenant_id: SKYLINE, conversation_id: CONV, flow_id: "flow-qualify",
    current_node: "menu", state: {}, updated_at: new Date().toISOString(),
  }];
};

describe("Real estate agency (Skyline Realty)", () => {

  describe("buyer qualification ask-flow (flowengine + flow vars)", () => {
    it('the "property" keyword starts qualification: welcome, then the intent menu (dry-run)', async () => {
      seedQualifierFlow();
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "Property", { sender: drySender(out), tenantId: SKYLINE })).toBe(true);
      expect(out.map(o => o.kind)).toEqual(["text", "buttons"]);
      expect(out[0].body).toBe("Welcome to Skyline Realty! 🏙 Zero spam — just homes.");
      expect(out[1].options).toEqual(["Buy a home", "Rent a home", "Talk to an agent"]);
      // The session parked on the menu node, under THIS tenant.
      expect(h.tables["wa_flow_sessions"]).toHaveLength(1);
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({
        conversation_id: CONV, flow_id: "flow-qualify", current_node: "menu", tenant_id: SKYLINE,
      });
    });

    it("the same keyword under a rival agency's tenant does not start Skyline's flow", async () => {
      seedQualifierFlow();   // the flow belongs to SKYLINE only
      const out: SimOutput[] = [];
      expect(await handleFlowMessage("conv-rival", BUYER_PHONE, "property", { sender: drySender(out), tenantId: RIVAL })).toBe(false);
      expect(out).toHaveLength(0);
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it('a TYPED intent — "I want to buy a home" — matches the Buy button loosely and asks for the budget', async () => {
      seedQualifierFlow();
      const out: SimOutput[] = [];
      await handleFlowMessage(CONV, BUYER_PHONE, "hi", { sender: drySender(out), tenantId: SKYLINE });
      const out2: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "I want to buy a home", { sender: drySender(out2), tenantId: SKYLINE })).toBe(true);
      expect(out2).toHaveLength(1);
      expect(out2[0]).toMatchObject({ kind: "text", body: "What's your budget for the purchase? A number works best — e.g. 7500000." });
      expect(h.tables["wa_flow_sessions"][0].current_node).toBe("ask_budget");
    });

    it("qualifies a buyer end-to-end: budget retried then captured, locality captured, CRM mirrored, tagged, wrap-up personalized", async () => {
      seedQualifierFlow();
      // A live contact record: attribute merges land on `attributes` exactly the
      // way the real store behaves, so {{budget}}/{{city}} resolve mid-flow.
      const contact: any = { id: "c-amit", phone: BUYER_PHONE, name: "Amit Verma", email: null, tags: [], attributes: {} };
      h.store.getContactByPhone.mockImplementation(async () => contact);
      h.store.setContactAttributes.mockImplementation(async (_p: string, attrs: Record<string, string>) => {
        contact.attributes = { ...contact.attributes, ...attrs };
      });

      // 1. "hi" → welcome + intent menu; the chat's AI knowledge gets scoped to listings.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "hi", { tenantId: SKYLINE })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(BUYER_PHONE, "Welcome to Skyline Realty! 🏙 Zero spam — just homes.", undefined);
      expect(h.wa.sendButtons).toHaveBeenCalledWith(BUYER_PHONE, "What brings you to Skyline today?", INTENT_MENU, undefined);
      expect(h.store.setConversationKbTag).toHaveBeenCalledWith(CONV, "listings");
      expect(h.store.claimReply).toHaveBeenCalledWith(CONV);

      // 2. Button tap → intent saved as an attribute, budget question asked.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "Buy a home", { tenantId: SKYLINE })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(BUYER_PHONE, { intent: "Buy a home" }, SKYLINE);

      // 3. A worded budget fails number validation → retried, never stored.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "around seventy lakhs", { tenantId: SKYLINE })).toBe(true);
      expect(h.wa.sendText.mock.calls.map(c => c[1])).toContain("Just the number, please — e.g. 7500000 or 75,00,000.");
      expect(contact.attributes.budget).toBeUndefined();
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({ current_node: "ask_budget", state: { menu: "menu", tries: 1 } });

      // 4. "75,00,000" passes (Indian comma format) → stored; the NEXT question
      //    is already personalized with the first name AND the captured budget.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "75,00,000", { tenantId: SKYLINE })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(BUYER_PHONE, { budget: "75,00,000" }, SKYLINE);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("Got it, Amit — around ₹75,00,000. Which locality are you house-hunting in?");

      // 5. The locality passes the city check → stored, mirrored to LeadSquared,
      //    the buyer is auto-tagged, and the wrap-up renders every flow var.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "Andheri West", { tenantId: SKYLINE })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(BUYER_PHONE, { city: "Andheri West" }, SKYLINE);
      expect(h.lsq.syncLeadProfile).toHaveBeenCalledWith(
        { phone: BUYER_PHONE, email: undefined, city: "Andheri West", name: "Amit Verma" }, SKYLINE);
      expect(h.store.addContactTag).toHaveBeenCalledWith(BUYER_PHONE, "qualified-buyer", SKYLINE);
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("Perfect, Amit! I'll line up 2-3 BHK options in Andheri West within ₹75,00,000 and WhatsApp you a shortlist today.");
      // The end node closed the session…
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
      // …so the next off-script message falls through to the AI.
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "do you also have plots in Pune", { tenantId: SKYLINE })).toBe(false);
    });

    it("mid-ask, a real question bails out to the AI instead of nagging about the budget format", async () => {
      seedQualifierFlow();
      h.tables["wa_flow_sessions"] = [{
        tenant_id: SKYLINE, conversation_id: CONV, flow_id: "flow-qualify",
        current_node: "ask_budget", state: {}, updated_at: new Date().toISOString(),
      }];
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "what are the brokerage charges?", { tenantId: SKYLINE })).toBe(false);
      expect(h.tables["wa_flow_sessions"]).toHaveLength(0);   // session closed → AI owns the thread
      expect(h.wa.sendText).not.toHaveBeenCalled();            // no "invalid number" nag
    });

    it('the unconnected "Talk to an agent" button escalates to a human instead of dead-ending', async () => {
      seedQualifierFlow();
      menuSession();
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "Talk to an agent", { tenantId: SKYLINE })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(BUYER_PHONE, "Connecting you with our team — someone will reply here shortly. 🙌", undefined);
      expect(h.store.setConversationStatus).toHaveBeenCalledWith(CONV, "escalated");
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it('a numbered text-menu pick — "2" — opens the rentals branch and ends cleanly (dry-run)', async () => {
      seedQualifierFlow();
      menuSession();
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, BUYER_PHONE, "2", { sender: drySender(out), tenantId: SKYLINE })).toBe(true);
      expect(out).toEqual([{ kind: "text", body: "We do rentals too — our rentals desk will send today's listings shortly." }]);
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);   // rent_done closed the session
    });

    it("loose matching accepts typed intents but refuses ambiguity and stubs (pure)", () => {
      const titles = INTENT_MENU.map(o => o.title);
      expect(looseIndex(titles, "I want to buy a home")).toBe(0);   // containment, spacing ignored
      expect(looseIndex(titles, "RENT A HOME!!")).toBe(1);          // case + punctuation ignored
      expect(looseIndex(["2 BHK in Andheri West", "3 BHK in Andheri West"], "andheri west")).toBeNull(); // 2 hits → AI answers
      expect(looseIndex(titles, "buy")).toBeNull();                 // too short to trust
      const menu = node("menu", "buttons", { buttons: INTENT_MENU });
      expect(matchOption(menu, "3")).toBe("opt_agent");             // numbered text-menu pick
      expect(matchOption(menu, "rent a home")).toBe("opt_rent");
      expect(matchOption(menu, "do you have sea-view flats?")).toBeNull();   // off-script → AI
    });

    it("fillVars personalizes from the contact and never leaks raw {{tokens}} (pure)", () => {
      const c = {
        name: "Amit Verma", phone: BUYER_PHONE, email: null,
        attributes: { budget: "75,00,000", city: "Andheri West" },
      };
      expect(fillVars("Hi {{name}}, {{City}} it is — ₹{{budget}} noted.", c))
        .toBe("Hi Amit, Andheri West it is — ₹75,00,000 noted.");   // first name + case-insensitive attrs
      expect(fillVars("Reaching you on {{phone}}, {{full_name}}.", c))
        .toBe(`Reaching you on ${BUYER_PHONE}, Amit Verma.`);
      expect(fillVars("Possession by {{possession_date}}", c))
        .toBe("Possession by ");                                    // unknown → "", never a raw token
    });
  });

  describe("lead events → webhook fan-out (integrations)", () => {
    // Literal public IPs: the REAL SSRF guard (assertPublicUrl) passes them
    // without a DNS lookup, so the delivery path runs end-to-end against the
    // recorded fetch stub.
    const ZAP_URL = "https://203.0.113.10/zapier/hooks/skyline-leads";
    const SLACK_URL = "https://203.0.113.20/services/T0SKY/B0LEADS/xyz";
    const PAUSED_URL = "https://203.0.113.30/old-crm/hook";
    const RIVAL_URL = "https://203.0.113.40/rival/hook";
    const SIGNING_SECRET = "skyline_signing_secret_2026";   // stored plaintext = legacy path of readSecret

    const seedIntegrations = () => {
      h.tables["wa_integrations"] = [
        { id: "int-zap", tenant_id: SKYLINE, kind: "webhook", name: "Zapier lead sync", active: true,
          config: { url: ZAP_URL, format: "generic" }, events: ["contact.created", "message.inbound"],
          status: "unverified", status_detail: null, secret: SIGNING_SECRET, last_event_at: null, created_at: "2026-07-01T00:00:00.000Z" },
        { id: "int-slack", tenant_id: SKYLINE, kind: "slack", name: "#leads", active: true,
          config: { url: SLACK_URL, format: "slack" }, events: ["contact.created"],
          status: "unverified", status_detail: null, secret: null, last_event_at: null, created_at: "2026-07-01T00:00:01.000Z" },
        { id: "int-paused", tenant_id: SKYLINE, kind: "webhook", name: "Paused hook", active: false,
          config: { url: PAUSED_URL, format: "generic" }, events: ["contact.created"],
          status: "unverified", status_detail: null, secret: null, last_event_at: null, created_at: "2026-07-01T00:00:02.000Z" },
        { id: "int-rival", tenant_id: RIVAL, kind: "webhook", name: "Rival hook", active: true,
          config: { url: RIVAL_URL, format: "generic" }, events: ["contact.created", "message.inbound"],
          status: "unverified", status_detail: null, secret: null, last_event_at: null, created_at: "2026-07-01T00:00:03.000Z" },
      ];
    };

    it('emitEvent("contact.created") delivers a SIGNED envelope to the webhook and a human line to Slack — only for this tenant\'s active subscribers', async () => {
      seedIntegrations();
      await emitEvent(SKYLINE, "contact.created", { name: "Amit Verma", phone: BUYER_PHONE, channel: "whatsapp" });

      expect(fetchCalls.map(c => c.url).sort()).toEqual([ZAP_URL, SLACK_URL].sort());   // never the paused or rival endpoints

      const zap = fetchCalls.find(c => c.url === ZAP_URL)!;
      expect(zap.method).toBe("POST");
      const envelope = JSON.parse(zap.body);
      expect(envelope).toMatchObject({
        event: "contact.created",
        tenant: SKYLINE,
        data: { name: "Amit Verma", phone: BUYER_PHONE, channel: "whatsapp" },
      });
      expect(envelope.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(new Date(envelope.occurredAt).toISOString()).toBe(envelope.occurredAt);
      expect(zap.headers["Content-Type"]).toBe("application/json");
      expect(zap.headers["User-Agent"]).toBe("AlabsConnect-Webhooks/1.0");
      expect(zap.headers["X-Alabs-Event"]).toBe("contact.created");
      expect(zap.headers["X-Alabs-Delivery"]).toBe(envelope.id);
      // The receiver can verify authenticity: HMAC over the EXACT raw body.
      expect(zap.headers["X-Alabs-Signature"]).toBe(signPayload(SIGNING_SECRET, zap.body));

      const slack = fetchCalls.find(c => c.url === SLACK_URL)!;
      expect(JSON.parse(slack.body)).toEqual({ text: "🆕 New lead: Amit Verma (whatsapp)." });
      expect(slack.headers["X-Alabs-Signature"]).toBeUndefined();   // Slack gets no signature

      // Both rows got a visible heartbeat; the paused/rival rows stayed untouched.
      const rows = h.tables["wa_integrations"];
      expect(rows.find(r => r.id === "int-zap")).toMatchObject({ status: "connected" });
      expect(rows.find(r => r.id === "int-zap")!.last_event_at).toBeTruthy();
      expect(rows.find(r => r.id === "int-slack")).toMatchObject({ status: "connected" });
      expect(rows.find(r => r.id === "int-paused")).toMatchObject({ status: "unverified", last_event_at: null });
      expect(rows.find(r => r.id === "int-rival")).toMatchObject({ status: "unverified", last_event_at: null });
    });

    it('emitEvent("message.inbound") reaches only its subscribers, carrying the inbound text; unsubscribed events cost zero HTTP calls', async () => {
      seedIntegrations();
      const text = "Is the 3BHK in Andheri West still available?";
      await emitEvent(SKYLINE, "message.inbound", { name: "Amit Verma", phone: BUYER_PHONE, text });

      expect(fetchCalls.map(c => c.url)).toEqual([ZAP_URL]);   // Slack subscribes to contact.created only
      const envelope = JSON.parse(fetchCalls[0].body);
      expect(envelope.event).toBe("message.inbound");
      expect(envelope.data.text).toBe(text);
      expect(fetchCalls[0].headers["X-Alabs-Signature"]).toBe(signPayload(SIGNING_SECRET, fetchCalls[0].body));

      // No subscriber for contact.optout → early return, no traffic at all.
      await emitEvent(SKYLINE, "contact.optout", { phone: BUYER_PHONE });
      expect(fetchCalls).toHaveLength(1);

      // The chat-destination summary clips a rambling message to 300 chars.
      const long = "Looking for a sea-facing 3BHK. ".repeat(20).trim();
      const line = humanText("message.inbound", { name: "Amit Verma", text: long });
      expect(line).toBe(`📩 Amit Verma: ${long.slice(0, 300)}`);
    });

    it("a broken endpoint is isolated: the other delivery still lands, its row records the failure, and emitEvent never throws", async () => {
      seedIntegrations();
      fetchFail.add("203.0.113.10");   // Zapier endpoint starts returning HTTP 500
      await expect(emitEvent(SKYLINE, "contact.created", { name: "Amit Verma", phone: BUYER_PHONE }))
        .resolves.toBeUndefined();

      // Slack was still delivered, concurrently and unharmed.
      expect(fetchCalls.map(c => c.url).sort()).toEqual([ZAP_URL, SLACK_URL].sort());
      const rows = h.tables["wa_integrations"];
      expect(rows.find(r => r.id === "int-zap")).toMatchObject({ status: "error" });
      expect(rows.find(r => r.id === "int-zap")!.status_detail).toMatch(/Last delivery failed: HTTP 500/);
      expect(rows.find(r => r.id === "int-slack")).toMatchObject({ status: "connected" });
    });

    it("createIntegration auto-generates a webhook signing secret, stores it ENCRYPTED, and returns the plaintext exactly once", async () => {
      process.env.SECRET_ENC_KEY = "unit-test-master-key-with-plenty-of-entropy!!";
      const { integration, secret } = await createIntegration(
        { kind: "webhook", name: "Site-visit sheet", config: { url: "https://203.0.113.50/sheet" }, events: ["contact.created"] },
        SKYLINE,
      );
      expect(secret).toMatch(/^[0-9a-f]{48}$/);        // shown once so the tenant can verify deliveries
      expect(integration.hasSecret).toBe(true);
      expect(integration.status).toBe("unverified");   // must pass a live Test before it's "connected"
      const row = h.tables["wa_integrations"].find(r => r.name === "Site-visit sheet")!;
      expect(row.tenant_id).toBe(SKYLINE);             // tdb stamped the tenant
      expect(row.secret).toMatch(/^v1:/);              // AES-GCM envelope at rest…
      expect(row.secret).not.toContain(secret);        // …a DB dump never leaks the plaintext
      expect(readSecret(row.secret)).toBe(secret);     // round-trips for delivery signing
    });
  });

  describe("[ref:CODE] source attribution (handlehub)", () => {
    it("the hoarding QR link: config normalizes the number/handle and trackedLink embeds the greeting + ref token", async () => {
      h.store.getTenantSetting.mockImplementation(async (_t: string, key: string, fallback: unknown) => {
        if (key === "handle_hub_number") return "+91 22 4890-1234";
        if (key === "handle_hub_handle") return "@SkylineRealty";
        if (key === "handle_hub_greeting") return "Hi Skyline! I saw your listing.";
        return fallback;
      });
      const cfg = await getHandleHubConfig(SKYLINE);
      expect(cfg).toEqual({ number: "912248901234", handle: "SkylineRealty", greeting: "Hi Skyline! I saw your listing." });
      expect(trackedLink(cfg, { refCode: "qr4main" }))
        .toBe(`https://wa.me/912248901234?text=${encodeURIComponent("Hi Skyline! I saw your listing. [ref:qr4main]")}`);
      // No number configured yet → nothing to point the QR at.
      expect(trackedLink({ ...cfg, number: "" }, { refCode: "qr4main" })).toBeNull();
    });

    it("the first inbound round-trips: parseRef finds the code, stripRef restores the human text", () => {
      const inbound = "Hi Skyline! I saw your listing. [ref:qr4main] Is the 2BHK still open?";
      expect(parseRef(inbound)).toBe("qr4main");
      expect(stripRef(inbound)).toBe("Hi Skyline! I saw your listing. Is the 2BHK still open?");   // token gone, spaces collapsed
      // Tolerant matching: parens, case, inner spacing.
      expect(parseRef("hello (REF: QR4MAIN )")).toBe("qr4main");
      // The user edited the prefill away → unattributed, but the chat still works.
      expect(parseRef("hi, looking for a flat")).toBeNull();
      expect(stripRef("hi, looking for a flat")).toBe("hi, looking for a flat");
    });

    it("resolveRef is tenant-scoped and recordTouch bumps only that source's counter — and never throws", async () => {
      h.tables["wa_handle_sources"] = [
        { id: "src-qr", tenant_id: SKYLINE, label: "MG Road hoarding QR", ref_code: "qr4main", kind: "qr",
          touches: 4, last_touch_at: null, created_at: "2026-06-01T00:00:00.000Z" },
        { id: "src-rival", tenant_id: RIVAL, label: "Rival's QR", ref_code: "qr4main", kind: "qr",
          touches: 0, last_touch_at: null, created_at: "2026-06-01T00:00:00.000Z" },
      ];
      // Same code, two tenants: each resolves to their OWN source.
      expect((await resolveRef(SKYLINE, "QR4MAIN"))?.id).toBe("src-qr");   // case-insensitive
      expect((await resolveRef(RIVAL, "qr4main"))?.id).toBe("src-rival");
      expect(await resolveRef(SKYLINE, "")).toBeNull();

      await recordTouch("src-qr", SKYLINE);
      const mine = h.tables["wa_handle_sources"].find(r => r.id === "src-qr")!;
      const theirs = h.tables["wa_handle_sources"].find(r => r.id === "src-rival")!;
      expect(mine.touches).toBe(5);
      expect(new Date(mine.last_touch_at).toISOString()).toBe(mine.last_touch_at);
      expect(theirs).toMatchObject({ touches: 0, last_touch_at: null });   // untouched
      // A stale/deleted source id is a soft no-op on the inbound path.
      await expect(recordTouch("src-deleted", SKYLINE)).resolves.toBeUndefined();
    });
  });

  describe("sales pipeline: stage moves fire the automations (pipeline)", () => {
    const seedPipeline = () => {
      h.tables["wa_pipeline_stages"] = [
        { id: "st-new", tenant_id: SKYLINE, name: "New enquiry", position: 0, color: "#64748b",
          lsq_stage: null, on_enter_tag: null, on_enter_sequence_id: null, is_won: false, is_lost: false },
        { id: "st-visit", tenant_id: SKYLINE, name: "Site visit scheduled", position: 1, color: "#8b5cf6",
          lsq_stage: "Opportunity", on_enter_tag: "site-visit", on_enter_sequence_id: "seq-visit", is_won: false, is_lost: false },
        { id: "st-rival", tenant_id: RIVAL, name: "New", position: 0, color: null,
          lsq_stage: null, on_enter_tag: null, on_enter_sequence_id: null, is_won: false, is_lost: false },
      ];
      h.tables["contacts"] = [{
        id: "c-amit", tenant_id: SKYLINE, phone: BUYER_PHONE, name: "Amit Verma",
        tags: [], pipeline_stage_id: null, pipeline_updated_at: null,
      }];
      // The visit-prep drip has a real first step → lib/sequences will enroll.
      h.tables["wa_sequences"] = [{
        id: "seq-visit", tenant_id: SKYLINE, name: "Site-visit prep", platform: "whatsapp",
        trigger_kind: "manual", trigger_value: null, active: true, channel_id: null, created_at: "2026-07-01T00:00:00.000Z",
      }];
      h.tables["wa_sequence_steps"] = [{
        id: "step-1", tenant_id: SKYLINE, sequence_id: "seq-visit", step_index: 0, delay_minutes: 0,
        action: { type: "text", text: "See you at the site visit! 📍 Here's the location pin." },
      }];
    };

    it("moveContact sets the stage tenant-scoped, rejects a rival's stage id, and null clears the card", async () => {
      seedPipeline();
      await moveContact("c-amit", "st-visit", SKYLINE);
      const amit = h.tables["contacts"][0];
      expect(amit.pipeline_stage_id).toBe("st-visit");
      expect(new Date(amit.pipeline_updated_at).toISOString()).toBe(amit.pipeline_updated_at);

      // A crafted request can't park Skyline's lead on a rival agency's board.
      await expect(moveContact("c-amit", "st-rival", SKYLINE)).rejects.toThrow("Stage not found");
      expect(h.tables["contacts"][0].pipeline_stage_id).toBe("st-visit");   // unchanged

      await moveContact("c-amit", null, SKYLINE);   // remove from the board — no stage check needed
      expect(h.tables["contacts"][0].pipeline_stage_id).toBeNull();

      // Stage reads are tenant-scoped too: Skyline never sees the rival's column.
      expect((await listStages(SKYLINE)).map(s => s.id)).toEqual(["st-new", "st-visit"]);
    });

    it('landing in "Site visit scheduled" auto-tags, REALLY enrolls the visit-prep drip, and pushes the mapped LSQ stage', async () => {
      seedPipeline();
      h.lsq.lsqConfigured.mockResolvedValue(true);
      h.lsq.getLeadIdByPhone.mockResolvedValue("LSQ-77");

      await applyStageEffects("c-amit", "st-visit", SKYLINE);

      expect(h.store.addContactTag).toHaveBeenCalledWith(BUYER_PHONE, "site-visit", SKYLINE);
      // The enrollment went through the REAL lib/sequences (not a stub of it).
      expect(h.tables["wa_sequence_enrollments"]).toHaveLength(1);
      expect(h.tables["wa_sequence_enrollments"][0]).toMatchObject({
        tenant_id: SKYLINE, sequence_id: "seq-visit", phone: BUYER_PHONE,
        platform: "whatsapp", status: "active", current_step: 0,
      });
      expect(Math.abs(Date.parse(h.tables["wa_sequence_enrollments"][0].next_run_at) - Date.now())).toBeLessThan(5000);
      expect(h.lsq.updateLeadStage).toHaveBeenCalledWith("LSQ-77", "Opportunity", SKYLINE);
    });

    it("stage effects fire only what's configured: no LSQ when unconfigured, bare stages do nothing, unknown contacts no-op", async () => {
      seedPipeline();
      // LSQ not connected → tag + drip still fire, CRM never called.
      await applyStageEffects("c-amit", "st-visit", SKYLINE);
      expect(h.store.addContactTag).toHaveBeenCalledWith(BUYER_PHONE, "site-visit", SKYLINE);
      expect(h.lsq.getLeadIdByPhone).not.toHaveBeenCalled();
      expect(h.lsq.updateLeadStage).not.toHaveBeenCalled();

      // LSQ connected but the lead isn't in the CRM yet → no stage push either.
      h.store.addContactTag.mockClear();
      h.lsq.lsqConfigured.mockResolvedValue(true);
      h.lsq.getLeadIdByPhone.mockResolvedValue(null);
      await applyStageEffects("c-amit", "st-visit", SKYLINE);
      expect(h.lsq.updateLeadStage).not.toHaveBeenCalled();

      // "New enquiry" has no automations configured → nothing fires.
      h.store.addContactTag.mockClear();
      delete h.tables["wa_sequence_enrollments"];
      await applyStageEffects("c-amit", "st-new", SKYLINE);
      expect(h.store.addContactTag).not.toHaveBeenCalled();
      expect(h.tables["wa_sequence_enrollments"] ?? []).toHaveLength(0);

      // A contact id that isn't this tenant's → quiet no-op (best-effort path).
      await applyStageEffects("c-ghost", "st-visit", SKYLINE);
      expect(h.store.addContactTag).not.toHaveBeenCalled();
    });
  });
});
