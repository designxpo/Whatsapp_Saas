// The button LeadSquared presses.
//
// decideNudge is tested exhaustively on its own; what is checked here is the
// wiring around it, where two mistakes would be silent:
//
//   1. A ten-digit number. LeadSquared stores Indian mobiles without the
//      country code as often as with it, and a bare ten-digit number reaches
//      NOBODY — the same mistake that made every tracked link and QR dead
//      earlier this year. It fails by delivering nothing, not by erroring.
//
//   2. Recording the send before it happens. If the attribute is written
//      first and the send then fails, tomorrow's message is skipped because
//      of one that never left — and nothing says so.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  contact: null as { phone: string; name: string; status: string; attributes: Record<string, string> } | null,
  conv: null as { id: string; lastInboundAt: string | null; assignedTo: string | null } | null,
  optedOut: false,
  sendResult: { id: "wamid.1" } as { id?: string; error?: string },
  sentTo: [] as { phone: string; template: string; params: string[] }[],
  attrWrites: [] as { phone: string; attrs: Record<string, string> }[],
  upserted: [] as string[],
  unknownUntilUpserted: false,
  reads: 0,
}));

// The route's own logic is what is under test, so API-key resolution and the
// plan/feature gates pass straight through: any key is tenant "t1", never gated.
vi.mock("@/lib/apiauth", () => ({ apiKeyTenant: async () => "t1" }));
vi.mock("@/lib/feature-guard", () => ({ guardFeature: async () => null, guardAccount: async () => null }));
// recordSequenceSend lives in dripstore in this codebase (it was in store).
vi.mock("@/lib/dripstore", () => ({ recordSequenceSend: async () => undefined }));
vi.mock("@/lib/store", () => ({
  upsertContacts: async (rows: { phone: string }[]) => { h.upserted.push(rows[0].phone); return { inserted: 1, skipped: 0 }; },
  getContactByPhoneLoose: async () => {
    h.reads++;
    // A lead LeadSquared knows and we do not: absent on the first read,
    // present once upsertContacts has run.
    if (h.unknownUntilUpserted && h.reads === 1) return null;
    return h.contact;
  },
  getConversationByPhone: async () => h.conv,
  setContactAttributes: async (phone: string, attrs: Record<string, string>) => { h.attrWrites.push({ phone, attrs }); },
  isOptedOut: async () => h.optedOut,
  getOrCreateConversation: async () => h.conv ?? { id: "c1" },
  appendConvMessage: async () => ({ id: "m1", createdAt: "" }),
  touchOutbound: async () => undefined,
}));
vi.mock("@/lib/whatsapp", () => ({
  sendTemplateSingle: async (phone: string, template: string, _lang: string, params: string[]) => {
    h.sentTo.push({ phone, template, params });
    return h.sendResult;
  },
}));
vi.mock("@/lib/channels", () => ({
  credsFor: async () => ({ token: "t", phoneId: "p", wabaId: "w" }),
  // The reply names the number the lead will see. A partial mock here left
  // displayNumberFor undefined, which threw on the success path — and every
  // test still passed, because they all asserted on the send spy and none
  // read the status. Hence the response-shape block at the end of this file.
  displayNumberFor: async () => "+91 95555 25908",
}));
vi.mock("@/lib/sequences", () => ({ listSequences: async () => [{ name: "RNR follow-up", channelId: "ch-ppc" }] }));
vi.mock("@/lib/leadsquared", () => ({ pushWaActivity: async () => undefined }));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => { void fn; } };
});

import { POST } from "@/app/api/crm/rnr-nudge/route";

const call = (body: Record<string, unknown>) =>
  POST(new Request("https://x.test/api/crm/rnr-nudge", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as never) as Promise<Response>;

beforeEach(() => {
  h.contact = { phone: "918368872108", name: "Priyesh Mishra", status: "active", attributes: {} };
  h.conv = { id: "c1", lastInboundAt: null, assignedTo: null };
  h.optedOut = false;
  h.sendResult = { id: "wamid.1" };
  h.sentTo = []; h.attrWrites = []; h.upserted = []; h.unknownUntilUpserted = false; h.reads = 0;
});

describe("the country code", () => {
  it("adds 91 to a bare ten-digit number", async () => {
    // A bare ten-digit number reaches nobody and errors at no point.
    await call({ phone: "8368872108", counsellor: "Neha" });
    expect(h.sentTo[0].phone).toBe("918368872108");
  });

  it("leaves a number that already has one alone", async () => {
    await call({ phone: "918368872108", counsellor: "Neha" });
    expect(h.sentTo[0].phone).toBe("918368872108");
  });

  it("strips whatever formatting LeadSquared sends", async () => {
    await call({ phone: "+91 83688-72108", counsellor: "Neha" });
    expect(h.sentTo[0].phone).toBe("918368872108");
  });

  it("refuses something too short to be a number", async () => {
    const r = await call({ phone: "12345", counsellor: "Neha" });
    expect(r.status).toBe(400);
    expect(h.sentTo).toHaveLength(0);
  });
});

describe("the send is recorded only once it has happened", () => {
  it("writes the timestamp after a successful send", async () => {
    await call({ phone: "918368872108", counsellor: "Neha" });
    expect(h.attrWrites).toHaveLength(1);
    expect(Object.keys(h.attrWrites[0].attrs)).toEqual(["rnr_nudge_a_at"]);
  });

  it("writes NOTHING when the send failed", async () => {
    // Recording first would skip tomorrow's message because of one that
    // never left, and nothing would say so.
    h.sendResult = { error: "rate limited" };
    const r = await call({ phone: "918368872108", counsellor: "Neha" });
    expect(r.status).toBe(502);
    expect(h.attrWrites).toHaveLength(0);
  });

  it("records B on the second day, not A again", async () => {
    h.contact!.attributes = {
      rnr_nudge_a_at: new Date(Date.now() - 36 * 3600_000).toISOString(),
      // Message B names the course; see the test below.
      "Product Name": "Adv. Cert. in Data Analytics & AI",
    };
    await call({ phone: "918368872108", counsellor: "Neha" });
    expect(h.sentTo[0].template).toBe("rnr_02_call_retry");
    expect(Object.keys(h.attrWrites[0].attrs)).toEqual(["rnr_nudge_b_at"]);
  });

  it("Message B needs a course on the lead, and refuses without one", async () => {
    // "We tried calling you about your {{course}} enquiry." A lead whose
    // Product Name is blank cannot receive B — 2,548 of the 2,668 contacts
    // are in that state today, so this is the common case, not the edge.
    h.contact!.attributes = { rnr_nudge_a_at: new Date(Date.now() - 36 * 3600_000).toISOString() };
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.sent).toBe(false);
    expect(j.missing).toContain("course");
    expect(h.sentTo).toHaveLength(0);
  });

  it("Message A does NOT need a course — it never names one", async () => {
    await call({ phone: "918368872108", counsellor: "Neha" });
    expect(h.sentTo[0].template).toBe("rnr_01_missed_call");
  });
});

describe("the counsellor's name comes from the click", () => {
  it("fills it from the request, which is the only place it exists", async () => {
    // Messages A and B both name the counsellor and our contact records do
    // not hold one. LeadSquared does, via mail merge.
    await call({ phone: "918368872108", counsellor: "Neha Sharma" });
    expect(h.sentTo[0].params).toContain("Neha");
  });

  it("refuses rather than sending 'this is  from AnalytixLabs'", async () => {
    const r = await call({ phone: "918368872108" });
    const j = await r.json();
    expect(j.sent).toBe(false);
    expect(j.missing).toContain("counsellor_name");
    expect(h.sentTo).toHaveLength(0);
  });

  it("falls back to whoever owns the chat", async () => {
    h.conv = { id: "c1", lastInboundAt: null, assignedTo: "Divesh Bakshi" };
    await call({ phone: "918368872108" });
    expect(h.sentTo[0].params).toContain("Divesh");
  });
});

describe("a refusal explains itself to the counsellor who pressed", () => {
  it("says so when the lead opted out", async () => {
    h.optedOut = true;
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.sent).toBe(false);
    expect(j.reason).toMatch(/opted out/);
    expect(h.sentTo).toHaveLength(0);
  });

  it("says so when one already went today", async () => {
    h.contact!.attributes = { rnr_nudge_a_at: new Date().toISOString() };
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.reason).toMatch(/already went to this lead today/);
  });

  it("says so when the lead has replied", async () => {
    h.contact!.attributes = { rnr_nudge_a_at: new Date(Date.now() - 36 * 3600_000).toISOString() };
    h.conv = { id: "c1", lastInboundAt: new Date(Date.now() - 2 * 3600_000).toISOString(), assignedTo: null };
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.reason).toMatch(/replied/);
    expect(h.sentTo).toHaveLength(0);
  });
});

describe("dryRun", () => {
  it("reports what it would send without sending it", async () => {
    const j = await (await call({ phone: "918368872108", counsellor: "Neha", dryRun: true })).json();
    expect(j.dryRun).toBe(true);
    expect(j.wouldSend).toBe("rnr_01_missed_call");
    expect(h.sentTo).toHaveLength(0);
    expect(h.attrWrites).toHaveLength(0);
  });
});

describe("a lead LeadSquared knows and we do not", () => {
  it("is created rather than refused", async () => {
    // The CRM is the system of record for leads; the portal learns about
    // most of them when somebody messages. A counsellor pressing the button
    // on a lead we have never seen must not hit a wall.
    h.unknownUntilUpserted = true;
    await call({ phone: "918368872108", counsellor: "Neha", name: "Priyesh" });
    expect(h.upserted).toContain("918368872108");
    expect(h.sentTo[0].template).toBe("rnr_01_missed_call");
  });

  it("does not re-create a lead we already have", async () => {
    await call({ phone: "918368872108", counsellor: "Neha" });
    expect(h.upserted).toHaveLength(0);
  });
});

// What the counsellor actually sees.
//
// This block exists because of a real afternoon lost on 13 October. The
// route answered `message: "A"` — meaning "nudge A" — and LeadSquared
// renders a field called `message` as its toast, so two counsellors saw a
// red badge containing one letter and reported the button as broken. It had
// worked both times.
describe("the reply a counsellor reads", () => {
  it("answers 200 on a send at all", async () => {
    // Nothing asserted this before, which is how a thrown TypeError on the
    // success path hid behind twelve green tests.
    const r = await call({ phone: "918368872108", counsellor: "Neha" });
    expect(r.status).toBe(200);
  });

  it("puts a SENTENCE in `message`, never the bare letter", async () => {
    const j = await (await call({ phone: "918368872108", counsellor: "Neha", name: "Priyesh" })).json();
    expect(j.sent).toBe(true);
    expect(j.message).not.toBe("A");
    expect(j.message.length).toBeGreaterThan(20);
    expect(j.message).toMatch(/Message A/);
  });

  it("keeps the A/B label, under its own name", async () => {
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.nudge).toBe("A");
  });

  it("names the number the lead will see it arrive from", async () => {
    // The campaign sends from its own line, not the counsellor's, so the
    // message lands in a chat they do not have open. Saying which number
    // is the difference between "it worked" and "it is broken".
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.message).toContain("+91 95555 25908");
    expect(j.from).toBe("+91 95555 25908");
  });

  it("does not promise delivery, and says what to do if nothing lands", async () => {
    // Meta returns a message id before it decides whether to deliver.
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.message).toMatch(/press again/i);
  });

  // LeadSquared prints the raw JSON when there is no `message` field. A
  // counsellor pressing twice — the commonest thing that happens — was shown
  // {"sent":false,"reason":"A WhatsApp message already went to this lead
  // today. One a day is the limit."}, braces and all, in a red box.
  it("gives the one-a-day refusal a sentence, not raw JSON", async () => {
    h.contact = {
      phone: "918368872108", name: "Priyesh", status: "active",
      attributes: { rnr_nudge_a_at: new Date().toISOString() },
    };
    const j = await (await call({ phone: "918368872108", counsellor: "Neha" })).json();
    expect(j.sent).toBe(false);
    expect(j.message).toContain("already went to this lead today");
    expect(j.message).not.toMatch(/[{}"]/);          // no JSON punctuation
  });

  it("gives EVERY refusal a message, whatever the reason", async () => {
    // A missing phone is the other thing a counsellor can trip over.
    const j = await (await call({ phone: "12345", counsellor: "Neha" })).json();
    expect(typeof j.message).toBe("string");
    expect(j.message.length).toBeGreaterThan(10);
  });
});
