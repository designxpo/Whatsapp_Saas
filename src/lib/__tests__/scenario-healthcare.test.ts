// Healthcare clinic industry scenario — backend contract suite.
//
// FEATURE CONTRACT this suite locks in, told as one clinic's patient journey
// ("Sunrise Family Clinic" runs its front desk on WhatsApp; OPD hours are
// 08:00–20:00 IST and a night pharmacy hotline covers 22:00–06:00 IST):
//
//  1. messaging-settings — per-tenant welcome/away config merges over the
//     defaults, working-hours math is timezone-offset based and handles the
//     OVERNIGHT window (22→6), and the AI master switch is per tenant.
//  2. welcome once-only — store.claimWelcome atomically claims the greeting so
//     a patient's second message never gets a duplicate welcome (the exact
//     guard the WhatsApp webhook relies on).
//  3. opt-out / consent — "STOP" suppresses the patient by last-10 identity
//     (even a contact imported without the country code flips to optedout),
//     opt-outs are strictly per-tenant, "START" restores them, markOptedIn
//     records proof-of-consent, and marketing audiences exclude both the
//     suppressed and the never-consented.
//  4. flowengine handoff — the triage flow's "handoff" node escalates the
//     conversation for a human, keeps the bot ENABLED (a human reply is what
//     pauses it), closes the flow session, and an unconnected "speak to a
//     doctor" button auto-escalates instead of dead-ending. The dry-run
//     simulator never escalates a real conversation.
//  5. voice.ts — an inbound voice note transcribes via the tenant's own
//     provider (Gemini natively, OpenAI via Whisper, Anthropic via a dedicated
//     voice key) and NEVER throws into the message path: any failure → null.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub, the
// Meta send layers / CRM / transcribers are vi.fn boundaries. Zero network.

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tables: Record<string, Record<string, any>[]> = {};
  const wa = {
    sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), sendMedia: vi.fn(),
    sendProduct: vi.fn(), sendProductList: vi.fn(), sendCtaUrl: vi.fn(),
    sendCarouselTemplate: vi.fn(), sendTemplateSingle: vi.fn(), getCreds: vi.fn(),
  };
  // Store overrides: keep the module REAL (opt-outs, consent, settings, claims
  // run against the db stub); stub only the heavy conversation-side helpers.
  const storeOverrides = {
    appendConvMessage: vi.fn(),
    takeArmedFlow: vi.fn(),
    landCapturedLead: vi.fn(),
    upsertContacts: vi.fn(),
    getTenantSecret: vi.fn(),   // avoids the SECRET_ENC_KEY crypto path
  };
  const voice = {
    resolveTenantAi: vi.fn(),
    genaiCtor: vi.fn(),
    generateContent: vi.fn(),
    openaiCtor: vi.fn(),
    transcriptionsCreate: vi.fn(),
    speechCreate: vi.fn(),
  };
  return { tables, wa, storeOverrides, voice };
});

// ── Chainable, thenable Supabase stub. Ops apply lazily at await-time so
// `.update(p).eq(...)` filters correctly; supports LIKE (opt-out last-10
// matching) and `{ count: "exact" }` selects (isOptedOut).
vi.mock("@/lib/supabase", () => {
  type Row = Record<string, any>;
  const cmp = (a: any, b: any) => (typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? "")));
  const likeRe = (pattern: string) =>
    new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$");
  function from(table: string) {
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let conflict: string[] = [];
    const filters: ((r: Row) => boolean)[] = [];
    let sort: { col: string; asc: boolean } | null = null;
    let take: number | null = null;
    let single = false;
    let wantCount = false;
    let headOnly = false;
    const matches = () => (h.tables[table] ?? []).filter(r => filters.every(f => f(r)));
    const api: any = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) wantCount = true;
        if (opts?.head) headOnly = true;
        return api;
      },
      eq: (c: string, v: any) => { filters.push(r => r[c] === v); return api; },
      neq: (c: string, v: any) => { filters.push(r => r[c] !== v); return api; },
      in: (c: string, vs: any[]) => { filters.push(r => vs.includes(r[c])); return api; },
      lte: (c: string, v: any) => { filters.push(r => cmp(r[c], v) <= 0); return api; },
      gte: (c: string, v: any) => { filters.push(r => cmp(r[c], v) >= 0); return api; },
      like: (c: string, pattern: string) => { const re = likeRe(pattern); filters.push(r => re.test(String(r[c] ?? ""))); return api; },
      not: () => api,
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
      then: (resolve: (v: { data: any; error: null; count: number | null }) => any) => {
        const t = (h.tables[table] ??= []);
        let data: any = null;
        let count: number | null = null;
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
          if (wantCount) count = r.length;
          if (sort) { const s = sort; r = [...r].sort((a, b) => cmp(a[s.col], b[s.col]) * (s.asc ? 1 : -1)); }
          if (take != null) r = r.slice(0, take);
          data = headOnly ? null : single ? r[0] ?? null : r;
        }
        return resolve({ data, error: null, count });
      },
    };
    return api;
  }
  return {
    db: () => ({ from }),
    uploadPublic: vi.fn(async () => "https://cdn.example/voice-reply.mp3"),
  };
});

// Real store (opt-outs, consent, settings, welcome claim) over the db stub;
// only the heavy conversation-side helpers are stubbed.
vi.mock("@/lib/store", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/store")>();
  return { ...orig, ...h.storeOverrides };
});

// messaging-settings imports ./auth → next/headers must exist under vitest.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// flowengine's send/CRM boundaries.
vi.mock("@/lib/whatsapp", () => h.wa);
vi.mock("@/lib/instagram", () => ({
  sendIgMessage: vi.fn(async () => ({ ok: true, messageId: "ig_m" })),
  sendIgQuickReplies: vi.fn(async () => ({ ok: true, messageId: "ig_q" })),
}));
vi.mock("@/lib/messenger", () => ({
  sendFbMessage: vi.fn(async () => ({ ok: true, messageId: "fb_m" })),
  sendFbMedia: vi.fn(async () => ({ ok: true, messageId: "fb_md" })),
  sendFbQuickReplies: vi.fn(async () => ({ ok: true, messageId: "fb_q" })),
}));
vi.mock("@/lib/channels", () => ({ getChannel: vi.fn(async () => null) }));
vi.mock("@/lib/waforms", () => ({
  sendWaFormMessage: vi.fn(async () => ({ id: "wamid.form" })),
  getWaFormDef: vi.fn(async () => ({ title: "", fields: [] })),
  fieldSlug: (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
}));
vi.mock("@/lib/formresponses", () => ({
  recordFormSent: vi.fn(async () => undefined),
  recordFormSubmitted: vi.fn(async () => undefined),
  markFormAbandoned: vi.fn(async () => false),
}));
vi.mock("@/lib/leadsquared", () => ({ syncLeadProfile: vi.fn(async () => undefined) }));
vi.mock("@/lib/llm", () => ({ looksLikeCity: vi.fn(async () => true) }));
vi.mock("@/lib/commerce", () => ({ getProduct: vi.fn(async () => null) }));
vi.mock("@/lib/integrations", () => ({
  calcomSlots: vi.fn(async () => null),
  calcomBook: vi.fn(async () => false),
  matchSlot: vi.fn(() => null),
  extractEmail: vi.fn(() => null),
}));
vi.mock("@/lib/ssrf", () => ({ safeFetch: vi.fn(async () => ({ ok: true })) }));

// voice.ts transcribers — the mocked speech-to-text engines.
vi.mock("@/lib/ai/keys", () => ({
  resolveTenantAi: h.voice.resolveTenantAi,
  AiKeyMissingError: class extends Error {},
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models: { generateContent: typeof h.voice.generateContent };
    constructor(opts: { apiKey: string }) {
      h.voice.genaiCtor(opts);
      this.models = { generateContent: h.voice.generateContent };
    }
  },
}));
vi.mock("openai", () => ({
  default: class {
    audio: { transcriptions: { create: typeof h.voice.transcriptionsCreate }; speech: { create: typeof h.voice.speechCreate } };
    constructor(opts: { apiKey: string }) {
      h.voice.openaiCtor(opts);
      this.audio = { transcriptions: { create: h.voice.transcriptionsCreate }, speech: { create: h.voice.speechCreate } };
    }
  },
}));

import {
  getWelcomeSetting, setWelcomeSetting, getAwaySetting, setAwaySetting,
  isOutsideWorkingHours, isAiEnabled, setAiEnabled, WELCOME_DEFAULT, AWAY_DEFAULT,
  type AwaySetting,
} from "@/lib/messaging-settings";
import {
  claimWelcome, addOptout, removeOptout, isOptedOut, optoutSet, markOptedIn,
  recipientsForAudience,
} from "@/lib/store";
import { handleFlowMessage, drySender, type FlowGraph, type FlowNode, type SimOutput } from "@/lib/flowengine";
import { transcribeAudio, getVoiceReplyMode, voiceReplyAvailable } from "@/lib/voice";

const CLINIC = "33333333-3333-3333-3333-3333333333cc";   // "Sunrise Family Clinic"
const RIVAL = "44444444-4444-4444-4444-4444444444dd";    // an unrelated clinic
const PATIENT = "919812345678";                          // digits-only, as stored
const PATIENT_LOCAL = "9812345678";                      // same person, CSV-imported w/o country code
const CONV = "conv-clinic-1";

function resetWorld() {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
  for (const group of [h.wa, h.storeOverrides, h.voice]) {
    for (const fn of Object.values(group)) (fn as { mockReset(): void }).mockReset();
  }
  // Defaults — individual tests override where the story needs it.
  for (const k of [
    "sendText", "sendButtons", "sendList", "sendMedia", "sendProduct",
    "sendProductList", "sendCtaUrl", "sendCarouselTemplate", "sendTemplateSingle",
  ] as const) (h.wa as any)[k].mockResolvedValue({ id: "wamid.test" });
  h.storeOverrides.appendConvMessage.mockResolvedValue({ id: "m1", createdAt: "2026-07-06T10:00:00.000Z" });
  h.storeOverrides.takeArmedFlow.mockResolvedValue(null);
  h.storeOverrides.landCapturedLead.mockResolvedValue(undefined);
  h.storeOverrides.upsertContacts.mockResolvedValue({ inserted: 1, skipped: 0 });
  h.storeOverrides.getTenantSecret.mockResolvedValue(null);
  h.voice.resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "gm-key-clinic", model: "gemini-2.5-flash" });
  h.voice.generateContent.mockResolvedValue({ text: "transcript" });
  h.voice.transcriptionsCreate.mockResolvedValue({ text: "transcript" });
}
beforeEach(resetWorld);

// An IST wall-clock instant expressed in UTC (IST = UTC+5:30).
const istInstant = (isoIst: string) => new Date(new Date(isoIst + "+05:30"));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const node = (id: string, type: string, data: Record<string, unknown> = {}): FlowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data });

// Triage flow: start → greeting → menu (book / nurse / doctor) →
//   book   → OPD info → end
//   nurse  → HANDOFF node (explicit escalation)
//   doctor → (deliberately unconnected — exercises the auto-escalate safety net)
const triageGraph: FlowGraph = {
  nodes: [
    node("start", "start"),
    node("greet", "message", { text: "Welcome to Sunrise Family Clinic! 🌤" }),
    node("menu", "buttons", {
      text: "How can we help you today?",
      buttons: [
        { id: "b_book", title: "Book an appointment" },
        { id: "b_nurse", title: "Talk to a nurse" },
        { id: "b_doc", title: "Speak to a doctor" },
      ],
    }),
    node("book_info", "message", { text: "Our OPD runs 08:00–20:00 IST. Reply with a preferred day and time." }),
    node("nurse_handoff", "handoff", { text: "Connecting you to our duty nurse — they'll reply right here." }),
    node("book_end", "end"),
  ],
  edges: [
    { id: "e1", source: "start", target: "greet" },
    { id: "e2", source: "greet", target: "menu" },
    { id: "e3", source: "menu", sourceHandle: "b_book", target: "book_info" },
    { id: "e4", source: "menu", sourceHandle: "b_nurse", target: "nurse_handoff" },
    // b_doc intentionally has NO edge.
    { id: "e5", source: "book_info", target: "book_end" },
  ],
};

const seedTriageFlow = () => {
  h.tables["wa_flows"] = [{
    id: "flow-triage", tenant_id: CLINIC, name: "Patient triage", active: true,
    trigger_keywords: ["hi", "appointment"], platform: "whatsapp", channel_id: null,
    primary_kb_tag: null, graph: triageGraph,
    created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
  }];
};

const seedConversation = (over: Record<string, unknown> = {}) => {
  h.tables["wa_conversations"] = [{
    id: CONV, tenant_id: CLINIC, phone: PATIENT, status: "active",
    bot_enabled: true, needs_reply: true, welcomed: false, ...over,
  }];
  return h.tables["wa_conversations"][0];
};

describe("Healthcare clinic (Sunrise Family Clinic)", () => {

  describe("front-desk hours & auto-replies (messaging-settings)", () => {
    it("welcome/away settings are per-tenant partial overrides merged over safe defaults", async () => {
      // Fresh tenant: everything off until the clinic configures it.
      expect(await getWelcomeSetting(CLINIC)).toEqual(WELCOME_DEFAULT);
      expect(WELCOME_DEFAULT.enabled).toBe(false);

      await setWelcomeSetting(CLINIC, { enabled: true, text: "Namaste! You've reached Sunrise Family Clinic. 🩺" });
      await setAwaySetting(CLINIC, { enabled: true, startHour: 8, endHour: 20, text: "The clinic is closed. For emergencies call 108." });

      const welcome = await getWelcomeSetting(CLINIC);
      expect(welcome).toEqual({ enabled: true, text: "Namaste! You've reached Sunrise Family Clinic. 🩺" });
      const away = await getAwaySetting(CLINIC);
      expect(away).toMatchObject({ enabled: true, startHour: 8, endHour: 20, text: "The clinic is closed. For emergencies call 108." });
      expect(away.tzOffsetMinutes).toBe(330);   // unset field keeps the IST default

      // The rival clinic next door sees only the defaults — settings never leak.
      expect(await getWelcomeSetting(RIVAL)).toEqual(WELCOME_DEFAULT);
      expect(await getAwaySetting(RIVAL)).toEqual(AWAY_DEFAULT);
    });

    it("the AI auto-reply master switch defaults ON and only a human turns it off, per tenant", async () => {
      expect(await isAiEnabled(CLINIC)).toBe(true);            // default: assistant answers
      await setAiEnabled(false, CLINIC);                       // clinic pauses the AI (e.g. audit week)
      expect(await isAiEnabled(CLINIC)).toBe(false);
      expect(await isAiEnabled(RIVAL)).toBe(true);             // rival clinic unaffected
      await setAiEnabled(true, CLINIC);
      expect(await isAiEnabled(CLINIC)).toBe(true);
    });

    it("day shift 08:00–20:00 IST: away-message boundaries are exact", () => {
      const opd: AwaySetting = { ...AWAY_DEFAULT, enabled: true, startHour: 8, endHour: 20, tzOffsetMinutes: 330 };
      expect(isOutsideWorkingHours(opd, istInstant("2026-07-06T07:59:00"))).toBe(true);    // just before opening
      expect(isOutsideWorkingHours(opd, istInstant("2026-07-06T08:00:00"))).toBe(false);   // doors open
      expect(isOutsideWorkingHours(opd, istInstant("2026-07-06T13:00:00"))).toBe(false);   // mid-OPD
      expect(isOutsideWorkingHours(opd, istInstant("2026-07-06T19:59:00"))).toBe(false);   // last patient
      expect(isOutsideWorkingHours(opd, istInstant("2026-07-06T20:00:00"))).toBe(true);    // closed (end exclusive)
    });

    it("overnight shift 22:00–06:00 IST (night pharmacy): the window wraps past midnight", () => {
      const night: AwaySetting = { ...AWAY_DEFAULT, enabled: true, startHour: 22, endHour: 6, tzOffsetMinutes: 330 };
      expect(isOutsideWorkingHours(night, istInstant("2026-07-06T23:30:00"))).toBe(false);  // pharmacist on duty
      expect(isOutsideWorkingHours(night, istInstant("2026-07-07T03:00:00"))).toBe(false);  // past midnight, still open
      expect(isOutsideWorkingHours(night, istInstant("2026-07-06T22:00:00"))).toBe(false);  // shift starts
      expect(isOutsideWorkingHours(night, istInstant("2026-07-07T06:00:00"))).toBe(true);   // shift just ended
      expect(isOutsideWorkingHours(night, istInstant("2026-07-06T13:00:00"))).toBe(true);   // daytime → away
      // The SAME UTC instant is inside the shift only in the clinic's timezone:
      // 23:30 IST is 18:00 UTC — a UTC-configured tenant (tz 0) would be closed.
      expect(isOutsideWorkingHours({ ...night, tzOffsetMinutes: 0 }, istInstant("2026-07-06T23:30:00"))).toBe(true);
    });
  });

  describe("welcome message once-only (store.claimWelcome)", () => {
    it("only the first inbound claims the welcome — the second message never re-greets", async () => {
      const conv = seedConversation();
      // First patient message: webhook wins the claim and sends the welcome.
      expect(await claimWelcome(CONV)).toBe(true);
      expect(conv.welcomed).toBe(true);
      // Second message (or a racing duplicate webhook delivery): claim refused.
      expect(await claimWelcome(CONV)).toBe(false);
      expect(await claimWelcome(CONV)).toBe(false);
      // A different patient's fresh conversation still gets its own welcome.
      h.tables["wa_conversations"].push({ id: "conv-clinic-2", tenant_id: CLINIC, welcomed: false });
      expect(await claimWelcome("conv-clinic-2")).toBe(true);
    });
  });

  describe("opt-out STOP / consent (store)", () => {
    it("STOP suppresses the patient by last-10 identity — even a contact imported without the country code", async () => {
      // Front desk imported the patient from a CSV without +91; the rival clinic
      // has the full number — their consent records must never interact.
      h.tables["contacts"] = [
        { id: "c-asha", tenant_id: CLINIC, phone: PATIENT_LOCAL, name: "Asha Rao", status: "active", opted_in: true },
        { id: "c-rival", tenant_id: RIVAL, phone: PATIENT, name: "Asha Rao", status: "active", opted_in: true },
      ];

      await addOptout(PATIENT, "inbound STOP", CLINIC);   // webhook passes the full E.164 digits

      expect(h.tables["wa_optouts"]).toEqual([{ tenant_id: CLINIC, phone: PATIENT_LOCAL, reason: "inbound STOP" }]);
      expect(h.tables["contacts"][0].status).toBe("optedout");   // local-format row flipped via last-10 LIKE
      expect(h.tables["contacts"][1].status).toBe("active");     // rival clinic untouched

      // Suppression checks resolve for BOTH representations of the number…
      expect(await isOptedOut(PATIENT, CLINIC)).toBe(true);
      expect(await isOptedOut(PATIENT_LOCAL, CLINIC)).toBe(true);
      // …and only for this tenant (separate WhatsApp number, separate consent).
      expect(await isOptedOut(PATIENT, RIVAL)).toBe(false);
      expect(await optoutSet(CLINIC)).toEqual(new Set([PATIENT_LOCAL]));
      expect(await optoutSet(RIVAL)).toEqual(new Set());
    });

    it("an appointment-recall broadcast reaches only consented, non-suppressed patients", async () => {
      h.tables["contacts"] = [
        { id: "c1", tenant_id: CLINIC, phone: PATIENT, name: "Asha Rao", status: "active", opted_in: true },
        { id: "c2", tenant_id: CLINIC, phone: "917700900100", name: "Imported NoConsent", status: "active", opted_in: false },
        { id: "c3", tenant_id: CLINIC, phone: "918800200300", name: "Stopped Patient", status: "optedout", opted_in: true },
        { id: "c4", tenant_id: RIVAL, phone: "916600100200", name: "Rival Patient", status: "active", opted_in: true },
      ];
      // Marketing default: onlyOptedIn=true → proof-of-consent gate.
      const marketing = await recipientsForAudience({ mode: "all" }, CLINIC, true);
      expect(marketing).toEqual([{ phone: PATIENT, fullName: "Asha Rao" }]);
      // Utility sends (onlyOptedIn=false) still exclude opted-out patients but
      // may reach imported-unattested ones.
      const utility = await recipientsForAudience({ mode: "all" }, CLINIC, false);
      expect(utility.map(r => r.phone).sort()).toEqual([PATIENT, "917700900100"].sort());
    });

    it("START restores the patient and markOptedIn records proof-of-consent", async () => {
      h.tables["contacts"] = [
        { id: "c-asha", tenant_id: CLINIC, phone: PATIENT, name: "Asha Rao", status: "optedout", opted_in: false },
      ];
      h.tables["wa_optouts"] = [{ tenant_id: CLINIC, phone: PATIENT_LOCAL, reason: "inbound STOP" }];

      await removeOptout(PATIENT, CLINIC);                 // patient replied START
      expect(h.tables["wa_optouts"]).toEqual([]);
      expect(h.tables["contacts"][0].status).toBe("active");
      expect(await isOptedOut(PATIENT, CLINIC)).toBe(false);

      // The webhook then records the inbound as fresh consent, with proof.
      await markOptedIn("+91 98123 45678", "inbound", "Patient replied START", CLINIC);   // formatting is normalized
      const c = h.tables["contacts"][0];
      expect(c.opted_in).toBe(true);
      expect(c.opt_in_source).toBe("inbound");
      expect(c.opt_in_proof).toBe("Patient replied START");
      expect(Number.isNaN(Date.parse(c.opt_in_at))).toBe(false);
    });

    it("markOptedIn matches EXACT digits only — a local-format import is missed (asymmetric with addOptout)", async () => {
      // BUG (src/lib/store.ts:195-199): markOptedIn matches `.eq("phone",
      // digits(phone))` while addOptout deliberately matches by last-10 LIKE
      // (store.ts:322-327 documents that exact-digit matching "missed it").
      // Consequence: a patient imported as "9812345678" who messages the clinic
      // (the webhook calls markOptedIn(from="919812345678", "inbound", …)) never
      // becomes opted_in, so a genuinely consented patient stays excluded from
      // reminder broadcasts — while the same identity IS suppressible via STOP.
      h.tables["contacts"] = [
        { id: "c-asha", tenant_id: CLINIC, phone: PATIENT_LOCAL, name: "Asha Rao", status: "active", opted_in: false },
      ];
      await markOptedIn(PATIENT, "inbound", "WhatsApp inbound message", CLINIC);
      expect(h.tables["contacts"][0].opted_in).toBe(false);   // BUG: current behavior — consent never lands
      // …yet the STOP path treats the two formats as the same person:
      await addOptout(PATIENT, "inbound STOP", CLINIC);
      expect(h.tables["contacts"][0].status).toBe("optedout");
    });
  });

  describe("escalation / handoff (flowengine)", () => {
    it('the triage flow escalates "Talk to a nurse" to a human: handoff text, escalated status, bot stays ON, session closed', async () => {
      seedTriageFlow();
      const conv = seedConversation();

      // 1. Patient opens with the trigger keyword → greeting + triage menu.
      expect(await handleFlowMessage(CONV, PATIENT, "hi", { tenantId: CLINIC })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(PATIENT, "Welcome to Sunrise Family Clinic! 🌤", undefined);
      expect(h.wa.sendButtons).toHaveBeenCalledWith(
        PATIENT, "How can we help you today?",
        [
          { id: "b_book", title: "Book an appointment" },
          { id: "b_nurse", title: "Talk to a nurse" },
          { id: "b_doc", title: "Speak to a doctor" },
        ],
        undefined,
      );
      expect(h.tables["wa_flow_sessions"]).toHaveLength(1);
      expect(h.tables["wa_flow_sessions"][0]).toMatchObject({ conversation_id: CONV, current_node: "menu", tenant_id: CLINIC });
      expect(conv.needs_reply).toBe(false);   // the flow claimed the reply — the AI won't double-answer

      // 2. Patient picks the nurse option (typed, case-insensitive).
      expect(await handleFlowMessage(CONV, PATIENT, "talk to a nurse", { tenantId: CLINIC })).toBe(true);
      expect(h.wa.sendText).toHaveBeenLastCalledWith(PATIENT, "Connecting you to our duty nurse — they'll reply right here.", undefined);
      expect(conv.status).toBe("escalated");            // flagged for the human inbox
      expect(conv.bot_enabled).toBe(true);              // the bot is NOT turned off — only a human reply pauses it
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);   // flow session over

      // 3. The next message is off-script → the flow stays silent (returns false)
      //    so the AI/human owns the thread; the escalation flag is untouched.
      expect(await handleFlowMessage(CONV, PATIENT, "how long is the wait?", { tenantId: CLINIC })).toBe(false);
      expect(conv.status).toBe("escalated");
    });

    it('an UNCONNECTED "Speak to a doctor" button auto-escalates instead of dead-ending', async () => {
      seedTriageFlow();
      const conv = seedConversation();
      h.tables["wa_flow_sessions"] = [{
        tenant_id: CLINIC, conversation_id: CONV, flow_id: "flow-triage",
        current_node: "menu", state: {}, updated_at: new Date().toISOString(),
      }];

      expect(await handleFlowMessage(CONV, PATIENT, "Speak to a doctor", { tenantId: CLINIC })).toBe(true);
      expect(h.wa.sendText).toHaveBeenCalledWith(PATIENT, "Connecting you with our team — someone will reply here shortly. 🙌", undefined);
      expect(conv.status).toBe("escalated");
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);
    });

    it("the dry-run simulator walks the handoff but never escalates a real conversation", async () => {
      seedTriageFlow();
      const conv = seedConversation();

      const out: SimOutput[] = [];
      await handleFlowMessage(CONV, PATIENT, "hi", { sender: drySender(out), tenantId: CLINIC });
      expect(out.map(o => o.kind)).toEqual(["text", "buttons"]);
      expect(out[1].options).toEqual(["Book an appointment", "Talk to a nurse", "Speak to a doctor"]);

      const out2: SimOutput[] = [];
      expect(await handleFlowMessage(CONV, PATIENT, "Talk to a nurse", { sender: drySender(out2), tenantId: CLINIC })).toBe(true);
      expect(out2).toEqual([{ kind: "text", body: "Connecting you to our duty nurse — they'll reply right here." }]);
      expect(conv.status).toBe("active");                // simulation: no real escalation
      expect(conv.needs_reply).toBe(true);               // and no reply claimed
      expect(h.wa.sendText).not.toHaveBeenCalled();      // nothing hit WhatsApp
      expect(h.tables["wa_flow_sessions"] ?? []).toHaveLength(0);   // session still ends in the sim
    });
  });

  describe("voice notes (voice.ts transcription)", () => {
    const voiceNote = { data: Buffer.from("fake-ogg-bytes"), mimeType: "audio/ogg; codecs=opus" };

    it("a Gemini tenant transcribes natively with its own key; the mime is normalized and the text trimmed", async () => {
      h.voice.resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "gm-key-clinic", model: "gemini-2.5-flash" });
      h.voice.generateContent.mockResolvedValue({ text: "  I need to reschedule tomorrow's physio session.  " });

      const text = await transcribeAudio(voiceNote, CLINIC);
      expect(text).toBe("I need to reschedule tomorrow's physio session.");
      expect(h.voice.resolveTenantAi).toHaveBeenCalledWith(CLINIC);
      expect(h.voice.genaiCtor).toHaveBeenCalledWith({ apiKey: "gm-key-clinic" });
      const req = h.voice.generateContent.mock.calls[0][0];
      expect(req.model).toBe("gemini-2.5-flash");
      expect(req.contents[0].parts[0].inlineData).toEqual({
        mimeType: "audio/ogg",                                    // "; codecs=opus" stripped
        data: voiceNote.data.toString("base64"),
      });
      expect(h.voice.openaiCtor).not.toHaveBeenCalled();          // never falls through to Whisper
    });

    it("an OpenAI tenant reuses its chat key for Whisper; the upload filename carries the audio format", async () => {
      h.voice.resolveTenantAi.mockResolvedValue({ provider: "openai", apiKey: "sk-oa-clinic", model: "gpt-4o-mini" });
      h.voice.transcriptionsCreate.mockResolvedValue({ text: "Please book a flu shot for Saturday." });

      const text = await transcribeAudio({ data: Buffer.from("mp3-bytes"), mimeType: "audio/mpeg" }, CLINIC);
      expect(text).toBe("Please book a flu shot for Saturday.");
      expect(h.voice.openaiCtor).toHaveBeenCalledWith({ apiKey: "sk-oa-clinic" });
      const req = h.voice.transcriptionsCreate.mock.calls[0][0];
      expect(req.model).toBe("whisper-1");
      expect(req.file.name).toBe("voice.mp3");                    // Whisper infers the format from the name
      expect(h.storeOverrides.getTenantSecret).not.toHaveBeenCalled();   // chat key reused, no dedicated key needed
    });

    it("an Anthropic tenant (no audio input) falls back to the dedicated voice key — or null without one", async () => {
      h.voice.resolveTenantAi.mockResolvedValue({ provider: "anthropic", apiKey: "sk-ant-clinic", model: "claude" });
      h.voice.transcriptionsCreate.mockResolvedValue({ text: "My son has a fever since last night." });

      // With a dedicated OpenAI voice key configured → Whisper with THAT key.
      h.storeOverrides.getTenantSecret.mockResolvedValue("sk-voice-dedicated");
      expect(await transcribeAudio(voiceNote, CLINIC)).toBe("My son has a fever since last night.");
      expect(h.storeOverrides.getTenantSecret).toHaveBeenCalledWith(CLINIC, "voice_openai_key");
      expect(h.voice.openaiCtor).toHaveBeenCalledWith({ apiKey: "sk-voice-dedicated" });

      // Without one → null (caller treats the message as un-transcribed audio).
      h.voice.openaiCtor.mockClear();
      h.storeOverrides.getTenantSecret.mockResolvedValue(null);
      expect(await transcribeAudio(voiceNote, CLINIC)).toBeNull();
      expect(h.voice.openaiCtor).not.toHaveBeenCalled();
    });

    it("transcription NEVER throws into the message path: crashes, empty speech and missing keys all → null", async () => {
      // The Gemini API blows up mid-call.
      h.voice.generateContent.mockRejectedValue(new Error("gemini 500"));
      await expect(transcribeAudio(voiceNote, CLINIC)).resolves.toBeNull();
      // No intelligible speech → the model returns "" → null, not "".
      h.voice.generateContent.mockResolvedValue({ text: "   " });
      await expect(transcribeAudio(voiceNote, CLINIC)).resolves.toBeNull();
      // The tenant has no AI key at all (resolveTenantAi rejects).
      h.voice.resolveTenantAi.mockRejectedValue(new Error("no key"));
      await expect(transcribeAudio(voiceNote, CLINIC)).resolves.toBeNull();
    });

    it("voice reply mode reads the tenant setting (invalid values degrade to off) and availability tracks the keys", async () => {
      h.tables["wa_settings"] = [
        { tenant_id: CLINIC, key: "voice_reply_mode", value: "mirror" },
        { tenant_id: RIVAL, key: "voice_reply_mode", value: "loudspeaker" },   // junk value
      ];
      expect(await getVoiceReplyMode(CLINIC)).toBe("mirror");
      expect(await getVoiceReplyMode(RIVAL)).toBe("off");

      // Synthesis availability: an OpenAI chat key OR a dedicated voice key.
      h.voice.resolveTenantAi.mockResolvedValue({ provider: "openai", apiKey: "sk-oa", model: "m" });
      expect(await voiceReplyAvailable(CLINIC)).toBe(true);
      h.voice.resolveTenantAi.mockResolvedValue({ provider: "gemini", apiKey: "gm", model: "m" });
      expect(await voiceReplyAvailable(CLINIC)).toBe(false);
      h.storeOverrides.getTenantSecret.mockResolvedValue("sk-voice-dedicated");
      expect(await voiceReplyAvailable(CLINIC)).toBe(true);
    });
  });
});
