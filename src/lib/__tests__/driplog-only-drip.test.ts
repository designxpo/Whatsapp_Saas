// What belongs in the drip log, and what does not.
//
// handleLeadResponse runs on EVERY inbound WhatsApp message, and it used to
// record every one of them into mx_RNR_DRIP_LOGS. So the field filled up with
// ordinary conversation from people who had never been in a drip — seen live
// on 14 Oct, where a lead's log read:
//
//   14Oct 11:09 ← Hi! I'd like to learn more about the courses offered by Anal
//   14Oct 11:10 ← Live Online
//   14Oct 11:11 ← Know more about Courses
//
// None of which came from a drip. The agreed split is the other way round:
// ordinary chat belongs on the WhatsApp activity timeline, and the drip log
// holds what the DRIP provoked. A log that records everything answers nothing.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  stopped: 0,
  logged: [] as string[],
}));

vi.mock("../sequences", () => ({ stopAllEnrollments: async () => h.stopped }));
vi.mock("../driplog", () => ({
  recordDripEvent: async (_p: string, line: string) => { h.logged.push(line); return true; },
  replyLine: (_at: Date, text: string) => `← ${text}`,
}));
vi.mock("../store", () => ({
  addOptout: async () => undefined,
  getContactByPhoneLoose: async () => ({ phone: "918368872108", name: "Priyesh", attributes: {} }),
}));
vi.mock("../leadsquared", () => ({
  ensureLead: async () => "lead-1",
  createLeadTask: async () => true,
  setLeadField: async () => true,
  pushWaActivity: async () => undefined,
}));
vi.mock("../whatsapp", () => ({ sendText: async () => ({ id: "m1" }), sendButtons: async () => ({ id: "m1" }) }));
vi.mock("../rnrreplies", () => ({ replyForTap: () => null }));

const { handleLeadResponse } = await import("../rnrhandoff");

beforeEach(() => { h.stopped = 0; h.logged = []; });

describe("ordinary conversation stays OUT of the drip log", () => {
  it("does not log a plain question from someone not in a drip", async () => {
    await handleLeadResponse("918368872108", "Hi! I'd like to learn more about the courses offered by AnalytixLabs.");
    expect(h.logged).toEqual([]);
  });

  it("does not log a flow answer", async () => {
    // "Live Online" and "Know more about Courses" are chatbot-flow button
    // labels. They were the bulk of the noise in the live field.
    for (const t of ["Live Online", "Know more about Courses", "Classroom", "Delhi"]) {
      await handleLeadResponse("918368872108", t);
    }
    expect(h.logged).toEqual([]);
  });

  it("does not log small talk", async () => {
    for (const t of ["Hi", "ok", "??", "thanks"]) await handleLeadResponse("918368872108", t);
    expect(h.logged).toEqual([]);
  });
});

describe("what the DRIP provoked is logged", () => {
  it("logs a reply that ended a running journey", async () => {
    // They were mid-drip and this message stopped it — that is a drip
    // conversation whatever they typed.
    h.stopped = 1;
    await handleLeadResponse("918368872108", "please call me");
    expect(h.logged).toEqual(["← please call me"]);
  });

  it("logs a tapped drip button even when no journey was running", async () => {
    // The journey can already have completed; the button was still ours.
    h.stopped = 0;
    await handleLeadResponse("918368872108", "Yes, call me now");
    expect(h.logged).toEqual(["← Yes, call me now"]);
  });

  it("logs the close-my-enquiry tap", async () => {
    h.stopped = 0;
    await handleLeadResponse("918368872108", "Close my enquiry");
    expect(h.logged).toHaveLength(1);
  });
});

describe("the boundary", () => {
  it("is the TAP, not the stop count — one is enough on its own", async () => {
    h.stopped = 0;
    await handleLeadResponse("918368872108", "Request a callback");
    const byTap = h.logged.length;

    h.logged = []; h.stopped = 2;
    await handleLeadResponse("918368872108", "anything at all");
    const byStop = h.logged.length;

    expect(byTap).toBe(1);
    expect(byStop).toBe(1);
  });
});
