// EdTech (course academy) industry scenario — backend contract suite.
//
// FEATURE CONTRACT this suite locks in, told as one academy's customer journey
// ("Ascend Academy" sells Data Science & Digital Marketing cohorts over WhatsApp
// and a website widget):
//
//  1. flowengine — a course-enquiry flow (start → welcome → program buttons →
//     ask name → ask email → wrap-up) triggers on a keyword, runs per-tenant,
//     and TYPED menu picks match loosely ("Data Science and gen ai" hits the
//     "Data Science & GenAI" button; ambiguous text falls through to the AI).
//  2. waforms / contact attributes — every captured answer (course pick, name,
//     email, chat-form fields) lands on contact attributes via the store, and a
//     web-chat visitor who shares a phone number becomes a REAL contact.
//  3. sequences — a "JOIN" keyword enrolls the lead into the cohort drip exactly
//     once, and hasActiveEnrollment suppresses the other bots while the drip
//     owns the thread (inactivity nudges excluded via hasActiveDripEnrollment).
//  4. entitlements — flows/sequences are plan-gated through the pure
//     entitlement-registry: overrides beat plan defaults, unknown keys and db
//     errors fail OPEN, the kill-switch disarms everything.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub, the
// store/whatsapp/LSQ/Graph-API layers are vi.fn boundaries. Zero network.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tables: Record<string, Record<string, any>[]> = {};
  const failTables = new Set<string>();
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
  };
  const wa = {
    sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), sendMedia: vi.fn(),
    sendProduct: vi.fn(), sendProductList: vi.fn(), sendCtaUrl: vi.fn(),
    sendCarouselTemplate: vi.fn(), sendTemplateSingle: vi.fn(), getCreds: vi.fn(),
  };
  const forms = { getWaFormDef: vi.fn(), sendWaFormMessage: vi.fn() };
  const formresponses = { recordFormSent: vi.fn(), recordFormSubmitted: vi.fn(), markFormAbandoned: vi.fn() };
  const syncLeadProfile = vi.fn();
  const plans = { getPlan: vi.fn(), listPlans: vi.fn() };
  const getFlag = vi.fn();
  const getTenantUsage = vi.fn();
  return { tables, failTables, store, wa, forms, formresponses, syncLeadProfile, plans, getFlag, getTenantUsage };
});

// ── Chainable, thenable Supabase stub. All ops apply lazily at await-time so
// `.update(p).eq(...)` filters correctly; delete/upsert really mutate the table.
vi.mock("@/lib/supabase", () => {
  type Row = Record<string, any>;
  const cmp = (a: any, b: any) => (typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? "")));
  function from(table: string) {
    if (h.failTables.has(table)) throw new Error(`db unavailable: ${table}`);
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
vi.mock("@/lib/channels", () => ({
  getChannel: vi.fn(async () => null),
  // Real (pure) precedence helpers — conversation override → channel default → global.
  effectiveAgentId: (conv: { agentId?: string | null } | null | undefined, channel?: { agentId?: string | null } | null) => conv?.agentId ?? channel?.agentId ?? null,
  effectiveKbTag: (conv: { primaryKbTag?: string | null } | null | undefined, channel?: { kbTag?: string | null } | null) => conv?.primaryKbTag ?? channel?.kbTag ?? null,
}));
vi.mock("@/lib/formresponses", () => h.formresponses);
vi.mock("@/lib/leadsquared", () => ({ syncLeadProfile: h.syncLeadProfile, pushWaActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/llm", () => ({ looksLikeCity: vi.fn(async () => true) }));
vi.mock("@/lib/commerce", () => ({ getProduct: vi.fn(async () => null) }));
vi.mock("@/lib/integrations", () => ({
  calcomSlots: vi.fn(async () => null),
  calcomBook: vi.fn(async () => false),
  matchSlot: vi.fn(() => null),
  extractEmail: vi.fn(() => null),
}));
vi.mock("@/lib/ssrf", () => ({ safeFetch: vi.fn(async () => ({ ok: true })) }));
// waforms: keep the PURE builders/sluggers real; stub only the Graph API calls.
vi.mock("@/lib/waforms", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/waforms")>();
  return { ...orig, getWaFormDef: h.forms.getWaFormDef, sendWaFormMessage: h.forms.sendWaFormMessage };
});
vi.mock("@/lib/plans", () => ({ getPlan: h.plans.getPlan, listPlans: h.plans.listPlans }));
vi.mock("@/lib/flags", () => ({ getFlag: h.getFlag }));
vi.mock("@/lib/usage", () => ({ getTenantUsage: h.getTenantUsage }));

import {
  handleFlowMessage, drySender, looseIndex, matchOption, fillVars, flowRunsOn,
  type FlowGraph, type FlowNode, type SimOutput, type WebchatOut,
} from "@/lib/flowengine";
import { matchKeywordSequence, enroll, stopEnrollment, hasActiveEnrollment, hasActiveDripEnrollment } from "@/lib/sequences";
import { getEntitlements, hasFeature, checkFeature } from "@/lib/entitlements";
import { tabAllowed, accountState, FEATURE_KEYS } from "@/lib/entitlement-registry";
import { fieldSlug, buildFlowJson, parseFlowJson, type WaFormField } from "@/lib/waforms";
import type { Channel } from "@/lib/channels";

const ACADEMY = "11111111-1111-1111-1111-1111111111aa";   // "Ascend Academy" tenant
const RIVAL = "22222222-2222-2222-2222-2222222222bb";     // an unrelated academy
const LEAD_PHONE = "919876543210";                        // digits-only, as stored
const CONV = "conv-edtech-1";

function resetWorld() {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
  h.failTables.clear();
  for (const group of [h.store, h.wa, h.forms, h.formresponses, h.plans]) {
    for (const fn of Object.values(group)) (fn as { mockReset(): void }).mockReset();
  }
  h.syncLeadProfile.mockReset();
  h.getFlag.mockReset();
  h.getTenantUsage.mockReset();
  // Defaults — individual tests override where the story needs it.
  h.store.appendConvMessage.mockResolvedValue({ id: "m1", createdAt: "2026-07-05T10:00:00.000Z" });
  h.store.getContactByPhone.mockResolvedValue(null);
  h.store.takeArmedFlow.mockResolvedValue(null);
  h.store.claimReply.mockResolvedValue(true);
  h.store.getConversationByPhone.mockResolvedValue(null);
  for (const k of [
    "touchOutbound", "setConversationStatus", "setContactAttributes", "setConversationAgent",
    "setConversationKbTag", "addContactTag", "updateContactProfile", "setConversationName",
    "setConversationLeadPhone", "upsertContacts", "landCapturedLead",
  ] as const) (h.store as any)[k].mockResolvedValue(undefined);
  for (const k of [
    "sendText", "sendButtons", "sendList", "sendMedia", "sendProduct",
    "sendProductList", "sendCtaUrl", "sendCarouselTemplate", "sendTemplateSingle",
  ] as const) (h.wa as any)[k].mockResolvedValue({ id: "wamid.test" });
  h.wa.getCreds.mockReturnValue({ token: "tok", phoneId: "ph1", wabaId: "waba1" });
  h.forms.getWaFormDef.mockResolvedValue({ title: "", fields: [] });
  h.forms.sendWaFormMessage.mockResolvedValue({ id: "wamid.form" });
  h.formresponses.recordFormSent.mockResolvedValue(undefined);
  h.formresponses.recordFormSubmitted.mockResolvedValue(undefined);
  h.formresponses.markFormAbandoned.mockResolvedValue(false);
  h.syncLeadProfile.mockResolvedValue(undefined);
  h.getFlag.mockResolvedValue(false);
  h.getTenantUsage.mockResolvedValue({ contacts: 0, conversations: 0, messages: 0, channels: 0, seats: 0 });
  h.plans.getPlan.mockResolvedValue(null);
  h.plans.listPlans.mockResolvedValue([]);
}
beforeEach(resetWorld);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const node = (id: string, type: string, data: Record<string, unknown> = {}): FlowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data });

const COURSE_MENU = [
  { id: "opt_ds", title: "Data Science & GenAI" },
  { id: "opt_mkt", title: "Digital Marketing" },
];

// start → welcome → program buttons ("Data Science & GenAI" / "Digital
// Marketing", saved as {{course}}) → ask name → ask email (validated) → wrap → end
const enquiryGraph: FlowGraph = {
  nodes: [
    node("start", "start"),
    node("welcome", "message", { text: "Welcome to Ascend Academy! 🎓" }),
    node("menu", "buttons", { text: "Which program are you interested in?", saveAs: "course", buttons: COURSE_MENU }),
    node("ask_name", "ask", { question: "Great pick! What's your full name?", attribute: "name" }),
    node("ask_email", "ask", {
      question: "And the best email for your brochure?", attribute: "email",
      validate: "email", retryText: "That email doesn't look right — mind re-typing it?",
    }),
    node("wrap", "message", { text: "Thanks {{name}}! Your {{course}} brochure is on its way to {{email}}." }),
    node("mkt", "message", { text: "Our Digital Marketing cohort starts on the 1st of every month." }),
    node("done", "end"),
    node("mkt_done", "end"),
  ],
  edges: [
    { id: "e1", source: "start", target: "welcome" },
    { id: "e2", source: "welcome", target: "menu" },
    { id: "e3", source: "menu", sourceHandle: "opt_ds", target: "ask_name" },
    { id: "e4", source: "menu", sourceHandle: "opt_mkt", target: "mkt" },
    { id: "e5", source: "ask_name", target: "ask_email" },
    { id: "e6", source: "ask_email", target: "wrap" },
    { id: "e7", source: "wrap", target: "done" },
    { id: "e8", source: "mkt", target: "mkt_done" },
  ],
};

const seedEnquiryFlow = () => {
  h.tables["wa_flows"] = [{
    id: "flow-enquiry", tenant_id: ACADEMY, name: "Course enquiry", active: true,
    trigger_keywords: ["hi", "courses"], platform: "whatsapp", channel_id: null,
    primary_kb_tag: "courses", graph: enquiryGraph,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  }];
};

describe("EdTech (course academy)", () => {

  describe("course-enquiry flow (flowengine)", () => {
    it("greeting keyword starts the flow: welcome, then the program menu (dry-run)", async () => {
      seedEnquiryFlow();
      const out: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "Hi", { sender: drySender(out), tenantId: ACADEMY })).toBe(true);
      expect(out.map(o => o.kind)).toEqual(["text", "buttons"]);
      expect(out[0].body).toBe("Welcome to Ascend Academy! 🎓");
      expect(out[1].options).toEqual(["Data Science & GenAI", "Digital Marketing"]);
      // The session parked on the menu node, under THIS tenant.
      expect(h.tables["wa_flow_sessions"]).toHaveLength(1);
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({
        conversation_id: CONV, flow_id: "flow-enquiry", current_node: "menu", tenant_id: ACADEMY,
      });
    });

    it("the same keyword under another tenant does not start this academy's flow", async () => {
      seedEnquiryFlow();   // the flow belongs to ACADEMY only
      const out: SimOutput[] = [];
      expect(await handleFlowMessage("conv-rival", LEAD_PHONE, "hi", { sender: drySender(out), tenantId: RIVAL })).toBe(false);
      expect(out).toHaveLength(0);
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it('a TYPED menu pick — "Data Science and gen ai" — matches the button loosely and branches', async () => {
      seedEnquiryFlow();
      const out: SimOutput[] = [];
      await handleFlowMessage(CONV, LEAD_PHONE, "hi", { sender: drySender(out), tenantId: ACADEMY });
      const out2: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "Data Science and gen ai", { sender: drySender(out2), tenantId: ACADEMY })).toBe(true);
      expect(out2).toHaveLength(1);
      expect(out2[0]).toMatchObject({ kind: "text", body: "Great pick! What's your full name?" });
      expect(h.tables["wa_flow_sessions"][0].current_node).toBe("ask_name");
    });

    it("loose matching accepts squash-equal typed picks but refuses ambiguity and stubs", () => {
      const titles = COURSE_MENU.map(o => o.title);
      expect(looseIndex(titles, "Data Science and gen ai")).toBe(0);   // "&" ≡ "and", spacing ignored
      expect(looseIndex(titles, "DIGITAL-MARKETING!!")).toBe(1);       // case + punctuation ignored
      expect(looseIndex(["Data Science & GenAI", "GenAI Bootcamp"], "gen ai")).toBeNull(); // 2 hits → AI answers
      expect(looseIndex(titles, "ds")).toBeNull();                     // too short to trust
      const menu = node("menu", "buttons", { buttons: COURSE_MENU });
      expect(matchOption(menu, "2")).toBe("opt_mkt");                  // numbered text-menu pick
      expect(matchOption(menu, "data science & genai")).toBe("opt_ds");
      expect(matchOption(menu, "evening batch timing?")).toBeNull();   // off-script → AI
    });

    it("captures course, name and email as contact attributes over a real WhatsApp exchange", async () => {
      seedEnquiryFlow();
      // A live contact record, kept in sync the way the real store is: attribute
      // merges land on `attributes`, and landCapturedLead copies the learned
      // conversation name onto the contact (emulated via setConversationName).
      const contact: any = { id: "c-1", phone: LEAD_PHONE, name: null, email: null, tags: [], attributes: {} };
      h.store.getContactByPhone.mockImplementation(async () => contact);
      h.store.setContactAttributes.mockImplementation(async (_p: string, attrs: Record<string, string>) => {
        contact.attributes = { ...contact.attributes, ...attrs };
      });
      h.store.setConversationName.mockImplementation(async (_k: string, name: string) => {
        contact.name = contact.name || name;
      });

      // 1. "hi" → welcome + program menu; the chat's AI knowledge gets scoped.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "hi", { tenantId: ACADEMY })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(LEAD_PHONE, "Welcome to Ascend Academy! 🎓", undefined);
      expect(h.wa.sendButtons).toHaveBeenCalledWith(LEAD_PHONE, "Which program are you interested in?", COURSE_MENU, undefined);
      expect(h.store.setConversationKbTag).toHaveBeenCalledWith(CONV, "courses");
      expect(h.store.claimReply).toHaveBeenCalledWith(CONV);

      // 2. Typed pick (loose match) → saved as the "course" attribute.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "Data science and gen ai", { tenantId: ACADEMY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(LEAD_PHONE, { course: "Data Science & GenAI" }, ACADEMY);

      // 3. The name lands as an attribute AND on the conversation + Contacts.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "Priya Sharma", { tenantId: ACADEMY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(LEAD_PHONE, { name: "Priya Sharma" }, ACADEMY);
      expect(h.store.setConversationName).toHaveBeenCalledWith(LEAD_PHONE, "Priya Sharma", ACADEMY);
      expect(h.store.landCapturedLead).toHaveBeenCalledWith(LEAD_PHONE, LEAD_PHONE, "whatsapp", ACADEMY);

      // 4. A typo'd email is retried, never stored.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "priya dot sharma at gmail", { tenantId: ACADEMY })).toBe(true);
      expect(h.wa.sendText.mock.calls.map(c => c[1])).toContain("That email doesn't look right — mind re-typing it?");
      expect(contact.attributes.email).toBeUndefined();

      // 5. A valid email is stored and mirrored to the CRM; the flow wraps up.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "priya.sharma@gmail.com", { tenantId: ACADEMY })).toBe(true);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(LEAD_PHONE, { email: "priya.sharma@gmail.com" }, ACADEMY);
      expect(h.syncLeadProfile).toHaveBeenCalledWith(
        { phone: LEAD_PHONE, email: "priya.sharma@gmail.com", city: undefined, name: "Priya Sharma" }, ACADEMY);
      // {{name}} → first name, {{course}} → the captured attribute, and the
      // reserved {{email}} token falls back to the just-captured attribute
      // (the profile email column is still empty at this point in the run).
      expect(h.wa.sendText.mock.calls.map(c => c[1]).at(-1))
        .toBe("Thanks Priya! Your Data Science & GenAI brochure is on its way to priya.sharma@gmail.com.");
      // The end node closed the session…
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
      // …so the next off-script message falls through to the AI.
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "thanks, when does it start?", { tenantId: ACADEMY })).toBe(false);
    });

    it("mid-ask, a real question bails out to the AI instead of nagging about validation", async () => {
      seedEnquiryFlow();
      h.tables["wa_flow_sessions"] = [{
        tenant_id: ACADEMY, conversation_id: CONV, flow_id: "flow-enquiry",
        current_node: "ask_email", state: {}, updated_at: new Date().toISOString(),
      }];
      expect(await handleFlowMessage(CONV, LEAD_PHONE, "what is the fee for this course?", { tenantId: ACADEMY })).toBe(false);
      expect(h.tables["wa_flow_sessions"]).toHaveLength(0);   // session closed → AI owns the thread
      expect(h.wa.sendText).not.toHaveBeenCalled();            // no "invalid email" nag
    });

    it("fillVars personalizes from the contact and never leaks raw {{tokens}}", () => {
      const c = {
        name: "Priya Sharma", phone: LEAD_PHONE, email: null,
        attributes: { course: "Data Science & GenAI", email: "priya.sharma@gmail.com" },
      };
      expect(fillVars("Hi {{name}}, your {{Course}} seat is reserved.", c))
        .toBe("Hi Priya, your Data Science & GenAI seat is reserved.");     // first name + case-insensitive attr
      expect(fillVars("Batch code {{batch_code}} starts soon", c))
        .toBe("Batch code  starts soon");                                    // unknown → "", never a raw token
      // The reserved {{email}} token prefers the profile email column but falls
      // back to a flow-captured "email" attribute when the column is empty.
      expect(fillVars("Brochure sent to {{email}}", c)).toBe("Brochure sent to priya.sharma@gmail.com");
    });

    it("flows run only on the channel kinds they target", () => {
      expect(flowRunsOn("whatsapp,webchat", "webchat")).toBe(true);
      expect(flowRunsOn("whatsapp,webchat", "instagram")).toBe(false);
      expect(flowRunsOn("both", "instagram")).toBe(true);    // legacy value = WA + IG
      expect(flowRunsOn("", "whatsapp")).toBe(true);         // historic default
      expect(flowRunsOn("", "webchat")).toBe(false);
    });
  });

  describe("chat-form capture on web chat (waforms + contact attributes)", () => {
    const admissionGraph: FlowGraph = {
      nodes: [
        node("start", "start"),
        node("wform", "waform", { formId: "F-ADMIT", text: "Let's get you registered for the demo class.", cta: "Open form" }),
        node("thanks", "message", { text: "You're all set — our counsellor will call you shortly." }),
        node("done", "end"),
      ],
      edges: [
        { id: "e1", source: "start", target: "wform" },
        { id: "e2", source: "wform", target: "thanks" },
        { id: "e3", source: "thanks", target: "done" },
      ],
    };
    const WEBCHAT_CHANNEL = { id: "ch-web", kind: "webchat", tenantId: ACADEMY, token: "" } as unknown as Channel;
    const VISITOR = "wc:visitor-77";   // web-chat conversations are keyed by an opaque id

    it("a web-chat visitor fills the WhatsApp form as a chat Q&A and lands in Contacts", async () => {
      h.tables["wa_flows"] = [{
        id: "flow-admit", tenant_id: ACADEMY, name: "Demo class registration", active: true,
        trigger_keywords: ["admission"], platform: "whatsapp,webchat", channel_id: null,
        primary_kb_tag: null, graph: admissionGraph,
        created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
      }];
      // The native WhatsApp form can't open in the widget → its fields are read
      // from Meta (mocked) and collected one question at a time.
      h.forms.getWaFormDef.mockResolvedValue({
        title: "Admissions",
        fields: [
          { type: "text", label: "Full name", required: true },
          { type: "email", label: "Email address", required: true },
          { type: "phone", label: "WhatsApp number", required: true },
        ],
      });
      const say = async (text: string) => {
        const collector: WebchatOut[] = [];
        const consumed = await handleFlowMessage(VISITOR, VISITOR, text, { channel: WEBCHAT_CHANNEL, collector, tenantId: ACADEMY });
        return { consumed, collector };
      };

      const t1 = await say("Admission");
      expect(t1.consumed).toBe(true);
      expect(t1.collector.map(m => m.body)).toEqual(["Let's get you registered for the demo class.\n\nFull name?"]);
      expect(h.formresponses.recordFormSent).toHaveBeenCalledWith(VISITOR, VISITOR, "F-ADMIT", ACADEMY);

      const t2 = await say("Rohan Verma");
      expect(t2.collector.map(m => m.body)).toEqual(["Email address?"]);
      // each answer lands on the SAME slug a real form submission would use
      expect(h.store.setContactAttributes).toHaveBeenCalledWith(VISITOR, { full_name: "Rohan Verma" }, ACADEMY);

      const t3 = await say("rohan@example.com");
      expect(t3.collector.map(m => m.body)).toEqual(["WhatsApp number?"]);

      const t4 = await say("+91 98765 43210");
      const answers = { full_name: "Rohan Verma", email_address: "rohan@example.com", whatsapp_number: "+91 98765 43210" };
      expect(h.formresponses.recordFormSubmitted).toHaveBeenCalledWith(VISITOR, VISITOR, answers, ACADEMY);
      // The captured phone turns the anonymous visitor into a REAL contact…
      expect(h.store.setConversationName).toHaveBeenCalledWith(VISITOR, "Rohan Verma", ACADEMY);
      expect(h.store.setConversationLeadPhone).toHaveBeenCalledWith(VISITOR, "919876543210");
      expect(h.store.upsertContacts).toHaveBeenCalledWith(
        [{ phone: "919876543210", name: "Rohan Verma", email: "rohan@example.com", tags: ["chat-form", "web-chat"] }],
        "chat_form", ACADEMY);
      expect(h.store.updateContactProfile).toHaveBeenCalledWith("919876543210", { name: "Rohan Verma", email: "rohan@example.com" }, ACADEMY);
      expect(h.store.setContactAttributes).toHaveBeenCalledWith("919876543210", answers, ACADEMY);
      // …is mirrored to the CRM, thanked, and the flow ends cleanly.
      expect(h.syncLeadProfile).toHaveBeenCalledWith(
        { phone: "919876543210", email: "rohan@example.com", city: undefined, name: "Rohan Verma" }, ACADEMY);
      expect(t4.collector.map(m => m.body)).toEqual(["You're all set — our counsellor will call you shortly."]);
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it("buildFlowJson → parseFlowJson round-trips the admission form spec", () => {
      const fields: WaFormField[] = [
        { type: "text", label: "Full name", required: true },
        { type: "email", label: "Email address", required: true },
        { type: "dropdown", label: "Program", required: false, options: ["Data Science & GenAI", "Digital Marketing"] },
      ];
      const back = parseFlowJson(buildFlowJson("Admissions", fields));
      expect(back.title).toBe("Admissions");
      expect(back.fields.map(f => ({ type: f.type, label: f.label, required: f.required }))).toEqual([
        { type: "text", label: "Full name", required: true },
        { type: "email", label: "Email address", required: true },
        { type: "dropdown", label: "Program", required: false },
      ]);
      expect(back.fields[2].options).toEqual(["Data Science & GenAI", "Digital Marketing"]);
      // and the webhook saves answers under the same slugs the chat Q&A uses
      expect(fieldSlug("Email address")).toBe("email_address");
      expect(fieldSlug("WhatsApp number")).toBe("whatsapp_number");
    });
  });

  describe("JOIN cohort drip (sequences)", () => {
    const seedJoinDrip = () => {
      h.tables["wa_sequences"] = [
        { id: "seq-join", tenant_id: ACADEMY, name: "Cohort onboarding", platform: "whatsapp", trigger_kind: "keyword", trigger_value: "JOIN", active: true, channel_id: null, created_at: "2026-07-01T00:00:00.000Z" },
        { id: "seq-idle", tenant_id: ACADEMY, name: "Re-engage quiet leads", platform: "whatsapp", trigger_kind: "inactivity", trigger_value: "30", active: true, channel_id: null, created_at: "2026-07-01T00:00:01.000Z" },
        { id: "seq-old", tenant_id: ACADEMY, name: "Old JOIN drip", platform: "whatsapp", trigger_kind: "keyword", trigger_value: "JOIN", active: false, channel_id: null, created_at: "2026-06-01T00:00:00.000Z" },
      ];
      h.tables["wa_sequence_steps"] = [
        { id: "st-1", tenant_id: ACADEMY, sequence_id: "seq-join", step_index: 0, delay_minutes: 0, action: { type: "text", text: "Welcome to the cohort! Your onboarding pack is on the way. 🎒" } },
        { id: "st-2", tenant_id: ACADEMY, sequence_id: "seq-join", step_index: 1, delay_minutes: 2880, action: { type: "template", templateName: "cohort_day2_checkin", languageCode: "en", params: [] } },
      ];
    };

    it('matchKeywordSequence resolves "JOIN" case-insensitively and exactly, per platform + tenant', async () => {
      seedJoinDrip();
      expect((await matchKeywordSequence("whatsapp", "  join ", ACADEMY))?.id).toBe("seq-join");
      expect((await matchKeywordSequence("whatsapp", "JOIN", ACADEMY))?.name).toBe("Cohort onboarding");  // not the inactive one
      expect(await matchKeywordSequence("whatsapp", "join now", ACADEMY)).toBeNull();   // exact trigger only
      expect(await matchKeywordSequence("instagram", "JOIN", ACADEMY)).toBeNull();      // platform-scoped
      expect(await matchKeywordSequence("whatsapp", "JOIN", RIVAL)).toBeNull();         // tenant-scoped
    });

    it("JOIN enrolls the lead once — re-sending the keyword never duplicates; step-less drafts never enroll", async () => {
      seedJoinDrip();
      await enroll("seq-join", { phone: LEAD_PHONE, conversationId: CONV }, ACADEMY);
      await enroll("seq-join", { phone: LEAD_PHONE }, ACADEMY);   // the lead sends JOIN again
      const rows = h.tables["wa_sequence_enrollments"];
      expect(rows).toHaveLength(1);                                // upsert on (sequence_id, phone)
      expect(rows[0]).toMatchObject({ sequence_id: "seq-join", phone: LEAD_PHONE, status: "active", current_step: 0, tenant_id: ACADEMY });
      expect(Math.abs(Date.parse(rows[0].next_run_at) - Date.now())).toBeLessThan(5000);  // step 1 fires immediately
      // A sequence with no steps yet (still being drafted) never creates an enrollment.
      h.tables["wa_sequences"].push({ id: "seq-empty", tenant_id: ACADEMY, name: "Draft", platform: "whatsapp", trigger_kind: "keyword", trigger_value: "WAITLIST", active: true, channel_id: null, created_at: "2026-07-02T00:00:00.000Z" });
      await enroll("seq-empty", { phone: "918888877777" }, ACADEMY);
      expect(await hasActiveEnrollment("918888877777", ACADEMY)).toBe(false);
    });

    it("an active drip suppresses the other bots until it stops (tenant-scoped)", async () => {
      seedJoinDrip();
      await enroll("seq-join", { phone: LEAD_PHONE, conversationId: CONV }, ACADEMY);
      expect(await hasActiveEnrollment(LEAD_PHONE, ACADEMY)).toBe(true);   // welcome + AI stay silent
      expect(await hasActiveEnrollment(LEAD_PHONE, RIVAL)).toBe(false);    // another academy unaffected
      expect(await hasActiveEnrollment("", ACADEMY)).toBe(false);          // blank-phone guard
      await stopEnrollment("seq-join", LEAD_PHONE);
      expect(await hasActiveEnrollment(LEAD_PHONE, ACADEMY)).toBe(false);  // AI resumes
    });

    it("an inactivity nudge does NOT count as a thread-owning drip", async () => {
      seedJoinDrip();
      h.tables["wa_sequence_enrollments"] = [{
        id: "en-1", tenant_id: ACADEMY, sequence_id: "seq-idle", phone: LEAD_PHONE,
        platform: "whatsapp", status: "active", current_step: 0, next_run_at: new Date().toISOString(),
      }];
      expect(await hasActiveEnrollment(LEAD_PHONE, ACADEMY)).toBe(true);
      expect(await hasActiveDripEnrollment(LEAD_PHONE, ACADEMY)).toBe(false);  // a returning lead still gets an instant AI reply
      await enroll("seq-join", { phone: LEAD_PHONE }, ACADEMY);
      expect(await hasActiveDripEnrollment(LEAD_PHONE, ACADEMY)).toBe(true);   // a real drip owns the thread
    });
  });

  describe("plan gating for flows & sequences (entitlements)", () => {
    const PLAN_LIMITS = { contacts: 1000, conversations_per_month: 500, messages_per_month: 5000, channels: 1, team_seats: 2 };
    const plan = (key: string, name: string, priceCents: number, features: Record<string, boolean>, active = true) =>
      ({ id: `plan-${key}`, key, name, priceCents, currency: "INR", interval: "month", limits: PLAN_LIMITS, features, sort: 0, active, stripePriceId: null });
    const PLANS = [
      plan("starter", "Starter", 99900, { flows: false, sequences: false, ch_webchat: false, ai_autoreply: true }),
      plan("growth", "Growth", 299900, { flows: true, sequences: true, ch_webchat: true }),
      plan("legacy", "Legacy Pro", 49900, { flows: true, sequences: true }, false),   // cheaper but retired
    ];
    const seedAcademyTenant = (over: Record<string, unknown> = {}) => {
      h.tables["tenants"] = [{
        id: ACADEMY, plan: "starter", features: { sequences: true }, grandfathered: false,
        status: "active", payment_status: "active", trial_ends_at: null, ...over,
      }];
      h.plans.getPlan.mockImplementation(async (key: string) => PLANS.find(p => p.key === key) ?? null);
      h.plans.listPlans.mockResolvedValue(PLANS);
      h.getFlag.mockResolvedValue(true);   // entitlement enforcement ON
    };

    it("a Starter academy is blocked from flows; the upsell names the cheapest ACTIVE plan that has them", async () => {
      seedAcademyTenant();
      const gate = await checkFeature(ACADEMY, "flows");
      expect(gate).toEqual({ ok: false, enforcing: true, feature: "flows", upgradeTo: "Growth" });   // never retired "Legacy Pro"
      // the admin tab hides off the same source of truth
      const ent = await getEntitlements(ACADEMY);
      expect(tabAllowed("flows", ent)).toBe(false);
      expect(tabAllowed("livechat", ent)).toBe(true);   // core tabs never gate
    });

    it("a per-tenant override unlocks sequences on top of the plan; unknown keys fail open", async () => {
      seedAcademyTenant();
      expect(await hasFeature(ACADEMY, "sequences")).toBe(true);     // override beats the plan default
      expect(await hasFeature(ACADEMY, "ch_webchat")).toBe(false);   // plan default holds
      expect(await hasFeature(ACADEMY, "crm")).toBe(true);           // in neither plan nor overrides → fail-open
    });

    it("the enforcement kill-switch turns every gate off", async () => {
      seedAcademyTenant();
      h.getFlag.mockResolvedValue(false);
      const gate = await checkFeature(ACADEMY, "flows");
      expect(gate.ok).toBe(true);
      expect(gate.enforcing).toBe(false);
      expect(tabAllowed("flows", await getEntitlements(ACADEMY))).toBe(true);
    });

    it("grandfathered academies keep every feature regardless of plan", async () => {
      seedAcademyTenant({ grandfathered: true });
      const ent = await getEntitlements(ACADEMY);
      for (const k of FEATURE_KEYS) expect(ent.features[k]).toBe(true);
      expect(ent.grandfathered).toBe(true);
    });

    it("a database error never locks a paying academy out (fail-open)", async () => {
      seedAcademyTenant();
      h.failTables.add("tenants");
      const ent = await getEntitlements(ACADEMY);
      expect(ent.features.flows).toBe(true);
      expect(await hasFeature(ACADEMY, "sequences")).toBe(true);
    });

    it("billing state: an expired trial pauses the workspace with a human message", async () => {
      seedAcademyTenant({ status: "trialing", payment_status: "trialing", trial_ends_at: "2026-06-01T00:00:00.000Z" });
      const ent = await getEntitlements(ACADEMY);
      const st = accountState(ent);
      expect(st).toMatchObject({ state: "trial_expired", active: false });
      expect(st.message).toMatch(/trial has ended/i);
      // the kill-switch is respected here too
      expect(accountState({ ...ent, enforcing: false }).active).toBe(true);
    });
  });
});
