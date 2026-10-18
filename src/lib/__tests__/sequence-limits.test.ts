// The three rules the RNR brief needs the engine to enforce, and the one it
// needed before anybody could see what the engine had done.
//
//   • a step that is not for this lead is SKIPPED, and the journey advances
//   • a lead who has had today's message is DEFERRED, not dropped
//   • what we sent appears in Live Chat, not only on the CRM timeline
//   • "not on WhatsApp" flags the contact instead of vanishing into last_error
//
// Mocked at the module boundary rather than by rebuilding PostgREST: what is
// under test is the engine's decisions, and a hand-written query-chain double
// mostly tests itself.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  due: [] as Record<string, unknown>[],
  seq: {} as Record<string, unknown>,
  steps: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  sent: [] as { template: string; params: string[] }[],
  sendResult: { id: "wamid.1" } as { id?: string; error?: string; code?: number },
  contact: null as { name?: string; attributes: Record<string, string>; tags: string[] } | null,
  sentToday: 0,
  logged: [] as { body: string; source: string }[],
  touched: [] as string[],
  receipts: [] as string[],
  flagged: [] as string[],
  activity: [] as string[],
  contactLookups: 0,
}));

vi.mock("../supabase", () => {
  const chain = (table: string) => {
    const st = { op: "select", claimed: false };
    const o: Record<string, unknown> = {
      select: () => { if (st.op === "update") st.claimed = true; return o; },
      eq: () => o, neq: () => o, lte: () => o, gte: () => o, lt: () => o,
      in: () => o, not: () => o, order: () => o, limit: () => o,
      update: (p: Record<string, unknown>) => { st.op = "update"; h.updates.push({ table, ...p }); return o; },
      insert: () => o,
      upsert: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: table === "wa_sequences" ? h.seq : null, error: null }),
      single: async () => ({ data: table === "wa_sequences" ? h.seq : null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        // An update that then selects is the atomic claim; it must come back
        // with a row or the engine treats the step as taken by another tick.
        if (st.op === "update") return Promise.resolve({ data: st.claimed ? [{ id: "e1" }] : null, error: null }).then(res);
        // drainSequences() with no tenant walks the tenants table first.
        const data = table === "tenants" ? [{ id: "t1" }]
          : table === "wa_sequence_enrollments" ? h.due
          : table === "wa_sequence_steps" ? h.steps : [];
        return Promise.resolve({ data, error: null, count: data.length }).then(res);
      },
    };
    return o;
  };
  return { db: () => ({ from: (t: string) => chain(t) }) };
});

vi.mock("../whatsapp", () => ({
  WA_NOT_ON_WHATSAPP: 131026,
  sendTemplateSingle: async (_p: string, name: string, _l: string, params: string[]) => { h.sent.push({ template: name, params }); return h.sendResult; },
  sendText: async () => h.sendResult,
  sendMedia: async () => h.sendResult,
  // Reached through quota.ts, which the drip loop now consults for the daily
  // ceiling. Not used by these tests — the cap itself is covered in
  // drip-daily-cap.test.ts — but the module graph needs it to resolve.
  getCreds: () => ({ token: "t", phoneId: "p" }),
}));

// The drip loop asks for the daily ceiling before it sends. These tests are
// about audience and pacing, so the cap is held wide open and out of the way.
vi.mock("../quota", () => ({ getDailyCap: async () => 100000 }));

vi.mock("../store", () => ({
  getConversationByPhone: async () => ({ id: "c1", lastInboundAt: null, botEnabled: true, status: "active" }),
  getOrCreateConversation: async () => ({ id: "c1" }),
  getContactByPhoneLoose: async () => { h.contactLookups++; return h.contact; },
  appendConvMessage: async (p: { body: string; source: string }) => { h.logged.push(p); return { id: "m1", createdAt: "" }; },
  touchOutbound: async (_id: string, body: string) => { h.touched.push(body); },
  // Read once per pass for the daily-ceiling check (drip-daily-cap.test.ts).
  dailySentCount: async () => 0,
}));

// The drip engine reads its send log and flags numbers through dripstore, and
// asks feature-guard whether the account may send at all.
vi.mock("../dripstore", () => ({
  countAutomatedSends: async () => h.sentToday,
  markNumberNotOnWhatsApp: async (phone: string) => { h.flagged.push(phone); return true; },
  recordSequenceSend: async (p: { metaMessageId?: string | null }) => { h.receipts.push(p.metaMessageId ?? "none"); },
}));
vi.mock("../feature-guard", () => ({ accountCanSend: async () => true }));
vi.mock("../channels", () => ({ getChannel: async () => ({ id: "ch1", token: "t", phoneNumberId: "p" }) }));
// A drip send is recorded in its own CRM field now, not on the WhatsApp
// activity timeline. The pure helpers stay real so the line format is the
// one production writes.
vi.mock("../driplog", async (orig) => ({
  ...(await orig<typeof import("../driplog")>()),
  recordDripEvent: async (_phone: string, line: string) => { h.activity.push(line); return true; },
}));
vi.mock("../leadsquared", () => ({ pushWaActivity: () => { throw new Error("drip traffic must not reach the WhatsApp timeline"); } }));
vi.mock("../lanes", () => ({
  leadLane: async () => "sales", laneAllows: () => true,
  isLane: () => false, isAidaStage: () => false,
}));
vi.mock("../instagram", () => ({ sendIgMessage: async () => ({ ok: true }), within24hWindow: () => true }));

import { drainSequences } from "../sequences";

const SEQ = {
  id: "s1", name: "RNR nurture", channel_id: "ch1", platform: "whatsapp",
  trigger_kind: "manual", active: true, stop_on_reply: false,
  send_start_hour: null, send_end_hour: null, max_per_day: null,
  skip_if_recent_reply_days: null,
};

const step = (i: number, audience: unknown = null, params: string[] = []) => ({
  id: `st${i}`, step_index: i, delay_minutes: 0,
  action: { type: "template", templateName: `rnr_r${i}`, languageCode: "en", params },
  audience,
});

beforeEach(() => {
  h.seq = { ...SEQ };
  h.steps = [step(0), step(1)];
  h.due = [{ id: "e1", sequence_id: "s1", phone: "919000000001", platform: "whatsapp", current_step: 0, status: "active", next_run_at: "2026-09-30T05:00:00Z", updated_at: "2026-09-30T04:00:00Z", conversation_id: "c1" }];
  h.updates = []; h.sent = []; h.logged = []; h.flagged = []; h.activity = []; h.contactLookups = 0; h.touched = []; h.receipts = [];
  h.sendResult = { id: "wamid.1" };
  h.contact = { attributes: {}, tags: [] };
  h.sentToday = 0;
});

/** The final write of the loop — the one carrying current_step / status. */
const advanceWrite = () => h.updates.find(u => "current_step" in u || u.status === "completed");

describe("a step that is not for this lead", () => {
  it("is skipped, and the journey ADVANCES to the next step", async () => {
    // Not stopped: a lead who cannot visit a centre should still get R+21.
    h.steps = [step(0, { attrIn: { city: ["Noida"] } }), step(1)];
    h.contact = { attributes: { city: "Pune" }, tags: [] };

    await drainSequences();

    expect(h.sent).toHaveLength(0);              // nothing went out
    expect(advanceWrite()?.current_step).toBe(1); // but the journey moved on
  });

  it("sends when the lead DOES match", async () => {
    h.steps = [step(0, { attrIn: { city: ["Noida"] } }), step(1)];
    h.contact = { attributes: { city: "Noida" }, tags: [] };

    await drainSequences();

    expect(h.sent.map(s => s.template)).toEqual(["rnr_r0"]);
  });

  it("does NOT tell the CRM we sent something we skipped", async () => {
    // A timeline entry for a message the lead never received is worse than
    // silence — it is what a counsellor reads before phoning to follow up.
    h.steps = [step(0, { attrIn: { city: ["Noida"] } }), step(1)];
    h.contact = { attributes: { city: "Pune" }, tags: [] };

    await drainSequences();

    expect(h.activity).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });

  it("a lead we know nothing about is skipped by an attrIn rule, not sent to", async () => {
    h.steps = [step(0, { attrIn: { course: ["Data Science"] } })];
    h.contact = null;                            // no contact record at all

    await drainSequences();

    expect(h.sent).toHaveLength(0);
  });

  it("a step with no audience still goes to everyone", async () => {
    h.contact = null;
    await drainSequences();
    expect(h.sent.map(s => s.template)).toEqual(["rnr_r0"]);
  });
});

describe("one message a day", () => {
  it("defers the step when the lead has already had today's", async () => {
    h.seq = { ...SEQ, max_per_day: 1 };
    h.sentToday = 1;

    await drainSequences();

    expect(h.sent).toHaveLength(0);
    // Deferred, not dropped: the step keeps its turn and next_run_at moves.
    const deferral = h.updates.find(u => "next_run_at" in u && !("current_step" in u));
    expect(deferral).toBeTruthy();
    expect(advanceWrite()).toBeUndefined();      // the step was NOT consumed
  });

  it("defers to TOMORROW, never to later today", async () => {
    h.seq = { ...SEQ, max_per_day: 1 };
    h.sentToday = 1;

    await drainSequences();

    const deferral = h.updates.find(u => "next_run_at" in u && !("current_step" in u));
    const when = new Date(deferral?.next_run_at as string);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    expect(when.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
  });

  it("sends when the lead is under the cap", async () => {
    h.seq = { ...SEQ, max_per_day: 2 };
    h.sentToday = 1;

    await drainSequences();

    expect(h.sent).toHaveLength(1);
  });

  it("no cap set → no counting, no deferral", async () => {
    h.sentToday = 99;
    await drainSequences();
    expect(h.sent).toHaveLength(1);
  });
});

describe("what we sent is visible where the counsellor looks", () => {
  it("updates the inbox row too, not just the thread", async () => {
    // Without this a drip lead appears in Live Chat as a name with no
    // preview line and no time, which reads like a chat that never happened.
    await drainSequences();
    expect(h.touched).toHaveLength(1);
    expect(h.touched[0]).toContain("rnr_r0");
  });

  it("does not touch the inbox row when the send failed", async () => {
    h.sendResult = { error: "rate limited" };
    await drainSequences();
    expect(h.touched).toEqual([]);
  });

  it("a drip message is written to the conversation, not only to the CRM", async () => {
    await drainSequences();

    expect(h.logged).toHaveLength(1);
    expect(h.logged[0].source).toBe("bot");
    expect(h.logged[0].body).toContain("rnr_r0");
    // The fixture's name is "rnr_r0"; humaniseTemplate strips the real
    // "rnr_NN_" prefix, which this one does not have. Its behaviour on the
    // actual template names is pinned in driplog.test.ts.
    expect(h.activity[0]).toMatch(/→ rnr r0$/);
    // And the receipt Meta's delivery callback matches on — previously
    // never exercised here, because the mock had no such export.
    expect(h.receipts).toEqual(["wamid.1"]);
  });

  it("nothing is logged when the send failed", async () => {
    h.sendResult = { error: "rate limited", code: 131056 };

    await drainSequences();

    expect(h.logged).toHaveLength(0);
    expect(advanceWrite()?.last_error).toBe("rate limited");
  });
});

describe("a number that is not on WhatsApp", () => {
  it("flags the contact so the same dead number is not retried forever", async () => {
    h.sendResult = { error: "Message Undeliverable", code: 131026 };

    await drainSequences();

    expect(h.flagged).toEqual(["919000000001"]);
  });

  it("does NOT flag an ordinary send failure", async () => {
    // A rate limit or an expired token says nothing about the lead's number,
    // and flagging one as a wrong number would send sales chasing ghosts.
    h.sendResult = { error: "(#131047) Re-engagement message", code: 131047 };

    await drainSequences();

    expect(h.flagged).toEqual([]);
  });

  it("does not flag when Meta returned no code at all", async () => {
    h.sendResult = { error: "HTTP 500" };

    await drainSequences();

    expect(h.flagged).toEqual([]);
  });
});

describe("the blanks are filled for THIS lead", () => {
  it("resolves {token} params from the contact", () => {
    // A literal here would greet four thousand people by the same name.
    h.steps = [step(0, null, ["{first_name}", "{course}"])];
    h.contact = { name: "rahul sharma", attributes: { course: "Data Science" }, tags: [] };
    return drainSequences().then(() => {
      // "Data Science with GenAI" is the course's name since the 14 Oct
      // rename; the old spelling on the contact still resolves to it.
      expect(h.sent[0].params).toEqual(["Rahul", "Data Science with GenAI"]);
    });
  });

  it("derives the values that are not stored on the lead at all", async () => {
    // role_1, role_2 and min_ctc come from a table keyed on the course.
    h.steps = [step(0, null, ["{role_1}", "{min_ctc}"])];
    h.contact = { name: "Rahul", attributes: { course: "Data Science" }, tags: [] };

    await drainSequences();

    expect(h.sent[0].params).toEqual(["Data Scientist", "₹6 lakh"]);
  });

  it("does NOT send when a token resolves to nothing", async () => {
    // Meta rejects an empty parameter with #132000, and the times it does
    // not, the lead reads "Hi , greetings from AnalytixLabs".
    h.steps = [step(0, null, ["{first_name}"])];
    h.contact = { name: "", attributes: {}, tags: [] };

    await drainSequences();

    expect(h.sent).toHaveLength(0);
  });

  it("says WHICH value was missing, on the enrolment", async () => {
    h.steps = [step(0, null, ["{min_ctc}"])];
    h.contact = { name: "Rahul", attributes: { course: "Business Analytics" }, tags: [] };

    await drainSequences();

    expect(String(advanceWrite()?.last_error)).toContain("{min_ctc}");
  });

  it("a step with literal params is sent unchanged, and costs no contact read", async () => {
    // The guard is there to keep a literal step from paying for a database
    // round trip per lead. Asserting the send alone would pass either way.
    h.steps = [step(0, null, ["Diwali offer"])];
    h.contact = null;

    await drainSequences();

    expect(h.sent[0].params).toEqual(["Diwali offer"]);
    expect(h.contactLookups).toBe(0);
  });

  it("a token step DOES read the contact — once", async () => {
    h.steps = [step(0, null, ["{first_name}"])];
    h.contact = { name: "Rahul", attributes: {}, tags: [] };

    await drainSequences();

    expect(h.contactLookups).toBe(1);
  });

  it("a step with no params at all still sends", async () => {
    h.steps = [step(0)];
    h.contact = null;
    await drainSequences();
    expect(h.sent).toHaveLength(1);
  });
});
