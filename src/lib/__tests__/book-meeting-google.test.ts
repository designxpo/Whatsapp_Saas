// The flow's "Book meeting" step, with either calendar the business connected.
//
// Google Calendar books into the business's own calendar with no guest — a
// service account can't invite one — so the step must not ask for an email
// and must not promise an invite. Cal.com still asks for the email it needs.
// Driven through the real flow engine with the database in memory; only the
// two calendar calls are stubbed. Phone numbers and names are synthetic.
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
  effectiveKbScope: (conv: { primaryKbTag?: string | null } | null | undefined, channel?: { kbTag?: string | null } | null) =>
    conv?.primaryKbTag ? { tag: conv.primaryKbTag, strict: false }
    : channel?.kbTag ? { tag: channel.kbTag, strict: true }
    : { tag: null, strict: false },
}));
vi.mock("@/lib/formresponses", () => h.formresponses);
vi.mock("@/lib/leadsquared", () => ({ syncLeadProfile: h.syncLeadProfile, pushWaActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/llm", () => ({ looksLikeCity: vi.fn(async () => true) }));
vi.mock("@/lib/commerce", () => ({ getProduct: vi.fn(async () => null) }));
// The real slot matching, email parsing and labels; only the two calendar
// calls are stubbed, so the test sees exactly what the flow asks the provider.
const sched = vi.hoisted(() => ({
  slots: vi.fn(), book: vi.fn(), calcomBook: vi.fn(),
}));
vi.mock("@/lib/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations")>()),
  scheduleSlots: sched.slots,
  scheduleBook: sched.book,
  calcomBook: sched.calcomBook,
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

const T = "33333333-3333-3333-3333-333333333333";
const PHONE = "919876500001";
const CONVK = "conv-book-1";
const SLOTS = [
  { id: "s0", iso: "2026-11-04T05:30:00.000Z", label: "Wed 04 Nov 11:00 am" },
  { id: "s1", iso: "2026-11-04T06:00:00.000Z", label: "Wed 04 Nov 11:30 am" },
];

function seed() {
  h.tables["wa_flows"] = [{
    id: "flow-book", tenant_id: T, name: "Book a call", active: true,
    trigger_keywords: ["book"], platform: "whatsapp", channel_id: null, primary_kb_tag: null,
    graph: {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "b1", type: "book", position: { x: 0, y: 0 }, data: { text: "Pick a time:" } },
        { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { text: "Thanks!" } },
      ],
      edges: [{ id: "e1", source: "start", target: "b1" }, { id: "e2", source: "b1", target: "m1" }],
    },
    created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
  }];
  sched.slots.mockReset(); sched.book.mockReset(); sched.calcomBook.mockReset();
  h.store.getContactByPhone.mockResolvedValue({ id: "c1", phone: PHONE, name: "Asha Verma", email: null, attributes: {} });
}
const said = () => h.wa.sendText.mock.calls.map(c => c[1] as string);

describe("Book meeting with Google Calendar", () => {
  it("offers the times, books the pick for this business, asks no email, promises no invite", async () => {
    seed();
    sched.slots.mockResolvedValue({ provider: "google_calendar", slots: SLOTS });
    sched.book.mockResolvedValue(true);
    expect(await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T })).toBe(true);
    expect(sched.slots).toHaveBeenCalledWith(T, { tz: "Asia/Kolkata" });
    expect(h.wa.sendList).toHaveBeenCalledTimes(1);

    expect(await handleFlowMessage(CONVK, PHONE, "2", { tenantId: T })).toBe(true);
    expect(sched.book).toHaveBeenCalledWith(T, expect.objectContaining({ startIso: SLOTS[1].iso, name: "Asha Verma", phone: PHONE, channel: "WhatsApp" }));
    // …and says who booked, so it also lands in Talko's Bookings.
    expect(sched.book.mock.calls[0][1].who).toEqual({ phone: PHONE, channel: "whatsapp", conversationId: null });
    expect(sched.calcomBook).not.toHaveBeenCalled();
    expect(said().join("\n")).not.toMatch(/email/i);
    expect(said().join("\n")).not.toMatch(/invite/i);
    expect(said()).toContain("✅ Booked for Wed 04 Nov 11:30 am! It's on our calendar — see you then.");
    expect(said()).toContain("Thanks!");
  });

  it("on Instagram, books for the chat (no phone) so it still lands in Bookings", async () => {
    seed();
    sched.slots.mockResolvedValue({ provider: "google_calendar", slots: SLOTS });
    sched.book.mockResolvedValue(true);
    h.tables["wa_flows"][0].platform = "instagram";
    const ig = { kind: "instagram", tenantId: T, id: "ch-ig", token: "tok", igUserId: "ig-biz" } as never;
    const CONV_ID = "5b0c7d1e-0000-4000-8000-000000000001";
    await handleFlowMessage(CONV_ID, "1789000111222", "book", { tenantId: T, channel: ig });
    await handleFlowMessage(CONV_ID, "1789000111222", "1", { tenantId: T, channel: ig });
    expect(sched.book).toHaveBeenCalledWith(T, expect.objectContaining({ phone: "", who: { contactKey: "1789000111222", channel: "instagram", conversationId: CONV_ID } }));
  });

  it("the flow simulator books nothing into Bookings", async () => {
    seed();
    sched.slots.mockResolvedValue({ provider: "google_calendar", slots: SLOTS });
    sched.book.mockResolvedValue(true);
    const out: SimOutput[] = [];
    await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T, sender: drySender(out) });
    await handleFlowMessage(CONVK, PHONE, "1", { tenantId: T, sender: drySender(out) });
    // The simulator only describes the step; it never books anything.
    expect(out.some(o => /would show available times/.test(o.body ?? ""))).toBe(true);
    expect(sched.book).not.toHaveBeenCalled();
  });

  it("a time taken meanwhile is not confirmed", async () => {
    seed();
    sched.slots.mockResolvedValue({ provider: "google_calendar", slots: SLOTS });
    sched.book.mockResolvedValue(false);
    await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T });
    await handleFlowMessage(CONVK, PHONE, "1", { tenantId: T });
    expect(said().some(t => /Booked/.test(t))).toBe(false);
    expect(said().some(t => /couldn't lock that slot in/.test(t))).toBe(true);
  });

  it("a reply that isn't one of the offered times books nothing", async () => {
    seed();
    sched.slots.mockResolvedValue({ provider: "google_calendar", slots: SLOTS });
    await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T });
    expect(await handleFlowMessage(CONVK, PHONE, "3:00 am tomorrow", { tenantId: T })).toBe(false);
    expect(sched.book).not.toHaveBeenCalled();
  });
});

describe("Book meeting with Cal.com (unchanged)", () => {
  it("still asks for the email Cal.com needs, then books there", async () => {
    seed();
    h.store.getContactByPhone.mockResolvedValue({ id: "c1", phone: PHONE, name: "Asha Verma", email: null, attributes: {} });
    sched.slots.mockResolvedValue({ provider: "calcom", slots: SLOTS });
    sched.calcomBook.mockResolvedValue(true);
    await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T });
    await handleFlowMessage(CONVK, PHONE, "1", { tenantId: T });
    expect(said()).toContain("Great choice! What email should I send the calendar invite to?");
    await handleFlowMessage(CONVK, PHONE, "asha@example.com", { tenantId: T });
    expect(sched.calcomBook).toHaveBeenCalledWith(T, expect.objectContaining({ startIso: SLOTS[0].iso, email: "asha@example.com" }));
    expect(sched.book).not.toHaveBeenCalled();
    expect(said()).toContain("✅ Booked! A calendar invite is on its way to asha@example.com.");
  });

  it("with no calendar connected, the step is skipped and the flow goes on", async () => {
    seed();
    sched.slots.mockResolvedValue(null);
    await handleFlowMessage(CONVK, PHONE, "book", { tenantId: T });
    expect(h.wa.sendList).not.toHaveBeenCalled();
    expect(said()).toContain("Thanks!");
  });
});
