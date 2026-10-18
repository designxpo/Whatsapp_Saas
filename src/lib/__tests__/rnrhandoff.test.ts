// Carrying out a tap: stop the drip, opt out if asked, raise the task.
//
// The ordering is the part that matters. Every CRM call in here can fail, and
// none of those failures may prevent the drip stopping — continuing to message
// somebody who just answered is the thing this exists to prevent.
import { describe, it, expect, vi, beforeEach } from "vitest";

let stopped = 0;
let stopThrows = false;
let optoutThrows = false;
let leadId: string | null = "L1";
let taskOk = true;
const calls: string[] = [];

vi.mock("@/lib/sequences", () => ({
  stopAllEnrollments: async (phone: string) => {
    calls.push(`stop:${phone}`);
    if (stopThrows) throw new Error("db down");
    return stopped;
  },
}));
let sendFails = false;
let contact: { name: string; attributes: Record<string, string> } | null = null;
let conversation: { id: string; assignedTo: string | null } | null = null;
const sent: { text: string; buttons: string[] }[] = [];
const loggedMsgs: { body: string; source: string }[] = [];

// The store mock used to provide addOptout ALONE. Everything else the reply
// path calls was undefined, so the whole "answer them" block threw on its
// first line and the catch swallowed it — the tests passed while the reply
// was never exercised once. That is how a missing chat-log write reached
// production and was found by a human tapping a button.
vi.mock("@/lib/store", () => ({
  addOptout: async (phone: string) => {
    calls.push(`optout:${phone}`);
    if (optoutThrows) throw new Error("db down");
  },
  getContactByPhoneLoose: async () => contact,
  getConversationByPhone: async () => conversation,
  appendConvMessage: async (p: { body: string; source: string }) => { loggedMsgs.push(p); return { id: "m1", createdAt: "" }; },
  touchOutbound: async () => { calls.push("touchOutbound"); },
}));
// recordSequenceSend lives in dripstore in this codebase (it was in store).
vi.mock("@/lib/dripstore", () => ({
  recordSequenceSend: async (p: { metaMessageId?: string | null }) => { calls.push(`receipt:${p.metaMessageId ?? "none"}`); },
}));
vi.mock("@/lib/whatsapp", () => ({
  sendText: async (_p: string, text: string) => {
    sent.push({ text, buttons: [] });
    return sendFails ? { error: "send failed" } : { id: "wamid.REPLY" };
  },
  sendButtons: async (_p: string, text: string, btns: { title: string }[]) => {
    sent.push({ text, buttons: btns.map(b => b.title) });
    return sendFails ? { error: "send failed" } : { id: "wamid.REPLY" };
  },
}));
let fieldOk = true;
let lastFieldValue = "";
// The drip conversation goes to its own CRM field, not the WhatsApp
// timeline. Mocked so the assertions read the line that would be written.
let dripLines: string[] = [];
vi.mock("@/lib/driplog", async (orig) => ({
  ...(await orig<typeof import("@/lib/driplog")>()),
  // Faithful to the real one: it appends to our copy AND overwrites the CRM
  // field with the rendered log, writing nothing when no field is configured
  // and reporting whether the write landed. handleLeadResponse no longer
  // writes that field itself — one writer, or the thread gets replaced by
  // the last line of itself (see rnrhandoff-one-writer.test.ts).
  recordDripEvent: async (_phone: string, line: string) => {
    dripLines.push(line);
    calls.push("driplog");
    const field = (process.env.LSQ_RNR_RESPONSE_FIELD ?? "").trim();
    if (!field) return false;
    lastFieldValue = line;
    calls.push(`field:${field}=${line.slice(0, 40)}`);
    return fieldOk;
  },
}));
vi.mock("@/lib/leadsquared", () => ({
  ensureLead: async () => { calls.push("ensureLead"); return leadId; },
  setLeadField: async (_id: string, attr: string, value: string) => {
    lastFieldValue = value;
    calls.push(`field:${attr}=${value.slice(0, 40)}`); return fieldOk;
  },
  createLeadTask: async (_id: string, p: { name: string; dueDate?: string }) => {
    calls.push(`task:${p.name}`); return taskOk;
  },
  pushWaActivity: async () => { calls.push("activity"); },
}));

import { handleLeadResponse } from "@/lib/rnrhandoff";

beforeEach(() => {
  calls.length = 0;
  stopped = 2; stopThrows = false; optoutThrows = false; leadId = "L1"; taskOk = true; fieldOk = true;
  sendFails = false; sent.length = 0; loggedMsgs.length = 0; lastFieldValue = ""; dripLines = [];
  contact = { name: "Priyesh Mishra", attributes: {} };
  conversation = { id: "c1", assignedTo: null };
  delete process.env.LSQ_RNR_RESPONSE_FIELD;
});

describe("stopping comes first", () => {
  it("stops the drip before touching the CRM", async () => {
    await handleLeadResponse("919000000001", "Yes, call me now");
    expect(calls[0]).toBe("stop:919000000001");
    expect(calls.indexOf("stop:919000000001")).toBeLessThan(calls.indexOf("ensureLead"));
  });

  it("reports how many journeys were stopped", async () => {
    stopped = 3;
    expect((await handleLeadResponse("91900", "Call me")).stopped).toBe(3);
  });

  it("a CRM failure does not undo the stop", async () => {
    leadId = null;                                   // CRM cannot find the lead
    const r = await handleLeadResponse("91900", "Yes, call me now");
    expect(r.stopped).toBe(2);
    expect(r.taskCreated).toBe(false);
  });

  it("a stop failure is swallowed, not thrown — a retry would redeliver", async () => {
    stopThrows = true;
    const r = await handleLeadResponse("91900", "Yes, call me now");
    expect(r.stopped).toBe(0);
    // and the handoff still tried the rest
    expect(calls).toContain("ensureLead");
  });
});

describe("Close my enquiry", () => {
  it("opts the lead out", async () => {
    const r = await handleLeadResponse("919000000002", "Close my enquiry");
    expect(r.optedOut).toBe(true);
    expect(calls).toContain("optout:919000000002");
  });

  it("raises no task — there is nothing for a human to chase", async () => {
    await handleLeadResponse("91900", "Close my enquiry");
    expect(calls.some(c => c.startsWith("task:"))).toBe(false);
  });

  it("an opt-out write failure is reported, not thrown", async () => {
    optoutThrows = true;
    const r = await handleLeadResponse("91900", "Close my enquiry");
    expect(r.optedOut).toBe(false);
  });
});

describe("tasks reach a counsellor", () => {
  it("'Yes, call me now' raises a call-now task", async () => {
    await handleLeadResponse("91900", "Yes, call me now");
    expect(calls.some(c => c.startsWith("task:Call now"))).toBe(true);
  });

  it("a typed question raises a callback task too", async () => {
    await handleLeadResponse("91900", "what are the fees?");
    expect(calls.some(c => c.includes("WhatsApp reply"))).toBe(true);
  });

  it("a slot tap names the slot in the task", async () => {
    await handleLeadResponse("91900", "Call me tomorrow");
    expect(calls.some(c => c.includes("tomorrow"))).toBe(true);
  });

  it("no task is attempted when the CRM has no lead id", async () => {
    leadId = null;
    await handleLeadResponse("91900", "Yes, call me now");
    expect(calls.some(c => c.startsWith("task:"))).toBe(false);
  });
});

describe("the drip conversation is recorded, and NOT on the WhatsApp timeline", () => {
  // Decided 1 October: the drip log lives in its own LeadSquared field so
  // the main activity timeline stays the record of what a human did.
  it("writes the lead's own words to the drip log", async () => {
    await handleLeadResponse("91900", "Just exploring");
    expect(calls).toContain("driplog");
    expect(dripLines[0]).toContain("← Just exploring");
  });

  it("records an opt-out too, where there is no task to raise", async () => {
    await handleLeadResponse("91900", "Close my enquiry");
    expect(calls).toContain("driplog");
    expect(dripLines[0]).toContain("← Close my enquiry");
  });

  it("marks it as INBOUND — the arrow is the whole grammar", async () => {
    await handleLeadResponse("91900", "Request a callback");
    expect(dripLines[0]).toMatch(/←/);
    expect(dripLines[0]).not.toMatch(/→/);
  });
});

// ── The wiring ──────────────────────────────────────────────────────────────
//
// The helper being correct is worth nothing if the webhook never calls it, or
// calls it in the wrong place. Source-level because driving the whole webhook
// would need Meta signatures, a channel and a database.
describe("the inbound webhook calls it, in the right order", () => {
  const RAW = require("fs").readFileSync(
    require("path").join(process.cwd(), "src/app/api/webhooks/whatsapp/route.ts"), "utf-8",
  ) as string;
  // Import lines are stripped before any ordering check. Without that, an
  // `import { matchKeywordSequence }` at the top of the file counts as the
  // keyword router "running" on line 16 and every ordering assertion passes
  // or fails for the wrong reason — which is exactly what happened first.
  const SRC = RAW.split("\n").filter(l => !/^\s*import\b/.test(l)).join("\n");

  it("calls handleLeadResponse", () => {
    expect(SRC).toContain("handleLeadResponse(from, text, { channel }");
  });

  it("awaits it — a floating promise in a lambda may never run", () => {
    expect(SRC).toMatch(/await handleLeadResponse\(/);
  });

  it("runs AFTER the opt-out gate, so STOP is still handled as STOP", () => {
    const optout = SRC.indexOf("OPTOUT_RE.test(text)");
    const handoff = SRC.indexOf("handleLeadResponse(from, text, { channel }");
    expect(optout).toBeGreaterThan(-1);
    expect(handoff).toBeGreaterThan(optout);
  });

  it("runs BEFORE the lead is handed to the bot or a flow", () => {
    // A person who answered a nurture belongs to a human, not to the bot
    // replying over the top of them.
    const handoff = SRC.indexOf("handleLeadResponse(from, text, { channel }");
    for (const later of ["matchKeywordSequence(", "runFlow(", "assistantReply("]) {
      const i = SRC.indexOf(later);
      if (i > -1) expect(handoff, `${later} should come after the handoff`).toBeLessThan(i);
    }
  });
});


// ── The dedicated LeadSquared response field ────────────────────────────────
//
// Agreed 29 September: drip responses go in their own field, kept apart from
// the ordinary WhatsApp chat log, so a workflow can fire on it alone. The
// schema name comes from their instance, so it is configured rather than
// hardcoded — and a wrong attribute returns HTTP 200 with nothing changed,
// which is why an unset field skips the write instead of guessing one.
describe("the drip-response field", () => {
  it("is not written when no field is configured", async () => {
    const r = await handleLeadResponse("91900", "Yes, call me now");
    expect(r.fieldWritten).toBe(false);
    expect(calls.some(c => c.startsWith("field:"))).toBe(false);
  });

  it("is written when configured", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    const r = await handleLeadResponse("91900", "Yes, call me now");
    expect(r.fieldWritten).toBe(true);
    expect(calls.some(c => c.startsWith("field:mx_RNR_Response="))).toBe(true);
  });

  it("carries what the lead actually asked for", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    await handleLeadResponse("91900", "Call me tomorrow");
    expect(calls.find(c => c.startsWith("field:"))).toMatch(/tomorrow/);
  });

  it("is written for a TYPED reply too, not only a tap", async () => {
    // Narrowed 15 Oct, and this is the bug the sales team reported. It used
    // to be written for ANY typed message, which is how ordinary chat from
    // people who had never been in the campaign filled the field. It must
    // still be written for a typed reply from somebody who WAS — that is the
    // common case, because students type rather than tap.
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    contact = { name: "Sanjay", attributes: { rnr_nudge_a_at: new Date().toISOString() } };
    await handleLeadResponse("91900", "what are the fees?");
    expect(calls.find(c => c.startsWith("field:"))).toMatch(/fees/);
  });

  it("is NOT written for a typed message from somebody never in the campaign", async () => {
    // The other half of the same decision: ordinary conversation belongs on
    // the WhatsApp timeline. Seen on the live field on 14 Oct — "Hi! I'd like
    // to learn more about the courses" from leads with no campaign history.
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    stopped = 0;                      // no enrolment — the default here is 2
    contact = { name: "Stranger", attributes: {} };
    await handleLeadResponse("91900", "what are the fees?");
    expect(calls.some(c => c.startsWith("field:"))).toBe(false);
  });

  it("is written BEFORE the task — the workflow keys off the field", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    await handleLeadResponse("91900", "Yes, call me now");
    const f = calls.findIndex(c => c.startsWith("field:"));
    const t = calls.findIndex(c => c.startsWith("task:"));
    expect(f).toBeGreaterThan(-1);
    expect(t).toBeGreaterThan(-1);
    expect(f).toBeLessThan(t);
  });

  it("is still written for Close my enquiry, which raises no task", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    const r = await handleLeadResponse("91900", "Close my enquiry");
    expect(r.fieldWritten).toBe(true);
    expect(calls.some(c => c.startsWith("task:"))).toBe(false);
  });

  it("a failed field write does not stop the task being raised", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_Response";
    fieldOk = false;
    const r = await handleLeadResponse("91900", "Yes, call me now");
    expect(r.fieldWritten).toBe(false);
    expect(r.taskCreated).toBe(true);
  });
});

describe("the lead actually hears back", () => {
  // Untested until a live tap produced silence in Live Chat. The reply may
  // have been delivered; there was no record either way, which is
  // indistinguishable from the send having failed.
  const NOON = new Date(2026, 9, 1, 12, 0, 0);

  it("sends an acknowledgement for a tap", async () => {
    const r = await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("within 30 minutes");
    expect(r.replySent).toBe(sent[0].text);
  });

  it("writes that acknowledgement into the chat log", async () => {
    // A counsellor opening the chat has to see what the lead was already
    // told, or they open by repeating it.
    await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(loggedMsgs).toHaveLength(1);
    expect(loggedMsgs[0].source).toBe("bot");
    expect(loggedMsgs[0].body).toContain("within 30 minutes");
  });

  it("records a receipt, so Meta's delivery callback has something to match", async () => {
    await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(calls).toContain("receipt:wamid.REPLY");
    expect(calls).toContain("touchOutbound");
  });

  it("logs the buttons alongside the text when it offers them", async () => {
    await handleLeadResponse("918368872108", "Yes, call me later", { now: NOON });
    expect(sent[0].buttons).toContain("Tomorrow morning");
    expect(loggedMsgs[0].body).toContain("[buttons:");
  });

  it("says nothing to a typed question — a counsellor is already alerted", async () => {
    const r = await handleLeadResponse("918368872108", "what are the fees?", { now: NOON });
    expect(sent).toHaveLength(0);
    expect(r.replySent).toBe("");
  });

  it("logs nothing when the send failed", async () => {
    // A chat log entry for a message that never arrived is worse than none:
    // the counsellor would open by referring to something the lead never saw.
    sendFails = true;
    const r = await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(r.replySent).toBe("");
    expect(loggedMsgs).toHaveLength(0);
  });

  it("still stops the drip when the reply cannot be sent", async () => {
    sendFails = true;
    const r = await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(r.stopped).toBe(2);
  });

  it("greets by the lead's first name, from their contact record", async () => {
    await handleLeadResponse("918368872108", "Request a callback", { now: NOON });
    expect(sent[0].text).toContain("Priyesh");
  });

  it("falls back to 'A counsellor' when nobody owns the chat", async () => {
    await handleLeadResponse("918368872108", "Yes, call me now", { now: NOON });
    expect(sent[0].text).toContain("A counsellor will call you");
    expect(sent[0].text).not.toMatch(/undefined|null/);
  });
});

describe("the CRM field has a length limit", () => {
  // mx_RNR_DRIP_LOGS is a LeadSquared Text field, MaxLength 256. Over-long
  // values come back HTTP 200 with nothing written — the quietest failure
  // LeadSquared offers, and the reason this is capped rather than trusted.
  it("never writes more than the field can hold", async () => {
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_DRIP_LOGS";
    await handleLeadResponse("91900", "x".repeat(4000));
    const written = calls.find(c => c.startsWith("field:"));
    expect(written).toBeTruthy();
    // calls records only the first 40 chars; assert on the real value.
    expect(lastFieldValue.length).toBeLessThanOrEqual(256);
  });

  it("a normal tap is nowhere near the limit, and is not truncated", async () => {
    // The VALUE changed on 15 Oct and the limit did not. The field used to
    // receive plan.activity — one rendered sentence — from a second writer
    // that overwrote the log with it. It now receives the log itself, so a
    // counsellor sees the thread rather than its last line. Asserted on
    // shape, not on an exact string, because the line carries a timestamp.
    process.env.LSQ_RNR_RESPONSE_FIELD = "mx_RNR_DRIP_LOGS";
    await handleLeadResponse("91900", "Request a callback");
    expect(lastFieldValue).toContain("Request a callback");
    expect(lastFieldValue.length).toBeLessThan(80);
    expect(lastFieldValue).not.toContain("…");
  });
});

// ── The regression that stopped paid attribution on 29 September ───────────
//
// This runs on EVERY inbound, and planForTap returns a callback task for any
// text it does not recognise — every "hi" from every new visitor. So
// ensureLead was creating the CRM lead for first-time strangers, nameless and
// with no source, at the top of the webhook before the tracked-link
// attribution had been read. The lead was born as Source "WhatsApp", and
// Source is never rewritten on a lead that already exists, so the real
// ppc-wa-* label could never land afterwards.
//
// Every test above runs with stopped = 2, so none of them saw this.
describe("a stranger's first message is not a nurture reply", () => {
  it("creates no CRM lead when nothing was running and the text is not a button", async () => {
    stopped = 0;
    const r = await handleLeadResponse("919000000001", "Hi, I found AnalytixLabs on Google");
    expect(calls).not.toContain("ensureLead");
    expect(r.taskCreated).toBe(false);
  });

  it("still stops whatever was running — the gate is only about the CRM", async () => {
    stopped = 0;
    await handleLeadResponse("919000000001", "Hi there");
    expect(calls).toContain("stop:919000000001");
  });

  it("acts on a real button even when no journey was running", async () => {
    // A tap can only come from a message we sent, so it is a nurture reply
    // whether or not an enrolment is still open.
    stopped = 0;
    await handleLeadResponse("919000000001", "Yes, call me now");
    expect(calls).toContain("ensureLead");
  });

  it("acts on an unrecognised reply when a journey WAS running", async () => {
    // The brief's rule, unchanged: someone who typed a question mid-nurture is
    // the most engaged lead there is.
    stopped = 1;
    await handleLeadResponse("919000000001", "what are the fees?");
    expect(calls).toContain("ensureLead");
  });

  it("still opts out on the closing button with nothing running", async () => {
    stopped = 0;
    const r = await handleLeadResponse("919000000001", "Close my enquiry");
    expect(r.optedOut).toBe(true);
  });
});
