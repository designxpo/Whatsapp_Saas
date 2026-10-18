// Meta accepts a send, returns a message id, and then drops the message.
//
// Measured on 13 October 2026. Two live leads were nudged; one came back
// seconds later as:
//
//   "This message was not delivered to maintain healthy ecosystem
//    engagement." — error 131049, the per-recipient marketing cap
//
// The route had already stamped rnr_nudge_a_at and told the counsellor it
// sent. Nothing retracted it, so "one a day" blocked the retry and the lead
// was queued to receive Message B the next day — "we tried calling you
// again" — about a Message A they never got.
//
// These tests pin the retraction. The dangerous mistake is not failing to
// revert; it is reverting the WRONG stamp, which re-sends a message the lead
// already has. So "refuse to guess" is asserted as hard as the happy path.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nudgeToRevert, REVERT_WINDOW_MS, attrFor } from "../rnrnudge";

const AT = "2026-10-13T05:43:59.000Z";
const at = (iso: string) => new Date(iso);
const minutesAfter = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000);

describe("nudgeToRevert — which stamp a failure retracts", () => {
  it("retracts A when A was stamped moments before the failure", () => {
    expect(nudgeToRevert({ sentA: AT, sentB: null }, at(AT))).toBe("A");
  });

  it("retracts B when B was the one that went", () => {
    expect(nudgeToRevert({ sentA: "2026-10-12T05:30:00.000Z", sentB: AT }, at(AT))).toBe("B");
  });

  it("retracts nothing when nothing was stamped", () => {
    expect(nudgeToRevert({ sentA: null, sentB: null }, at(AT))).toBeNull();
  });

  it("leaves YESTERDAY's successful message alone", () => {
    // The whole point. A failure today must not erase the record of a
    // message that was delivered yesterday — the lead would be sent it again.
    expect(nudgeToRevert({ sentA: "2026-10-12T05:30:00.000Z", sentB: null }, at(AT))).toBeNull();
  });

  it("picks the CLOSER stamp when both are inside the window", () => {
    // A then B a few minutes apart, and B is the one that failed.
    const a = minutesAfter(AT, -8).toISOString();
    const b = minutesAfter(AT, -1).toISOString();
    expect(nudgeToRevert({ sentA: a, sentB: b }, at(AT))).toBe("B");
    // …and the mirror image, so this is not passing by order of evaluation.
    expect(nudgeToRevert({ sentA: b, sentB: a }, at(AT))).toBe("A");
  });

  it("refuses once the failure is older than the window", () => {
    const stale = new Date(Date.parse(AT) + REVERT_WINDOW_MS + 60_000);
    expect(nudgeToRevert({ sentA: AT, sentB: null }, stale)).toBeNull();
  });

  it("accepts a failure right at the edge of the window", () => {
    const edge = new Date(Date.parse(AT) + REVERT_WINDOW_MS);
    expect(nudgeToRevert({ sentA: AT, sentB: null }, edge)).toBe("A");
  });

  it("survives junk timestamps rather than throwing", () => {
    for (const junk of ["", "not a date", "null"]) {
      expect(nudgeToRevert({ sentA: junk, sentB: null }, at(AT))).toBeNull();
    }
    expect(nudgeToRevert({ sentA: AT, sentB: null }, new Date(NaN))).toBeNull();
  });

  it("works when the failure webhook is a little late", () => {
    // Meta is usually instant but not contractually so.
    expect(nudgeToRevert({ sentA: AT, sentB: null }, minutesAfter(AT, 5))).toBe("A");
  });
});

// ── the side effects ───────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  contact: null as { phone: string; attributes: Record<string, string> } | null,
  cleared: [] as { phone: string; keys: string[] }[],
  written: [] as { phone: string; attrs: Record<string, string> }[],
  clearOk: true,
}));

vi.mock("../dripstore", () => ({
  clearContactAttributes: async (phone: string, keys: string[]) => { h.cleared.push({ phone, keys }); return h.clearOk; },
}));
vi.mock("../store", () => ({
  getContactByPhoneLoose: async () => h.contact,
  setContactAttributes: async (phone: string, attrs: Record<string, string>) => { h.written.push({ phone, attrs }); },
}));

const { revertDroppedNudge, DROP_REASON_ATTR, DROP_NUDGE_ATTR } = await import("../rnrdelivery");

const REASON = "This message was not delivered to maintain healthy ecosystem engagement.";

beforeEach(() => {
  h.contact = { phone: "919886098754", attributes: { [attrFor("A")]: AT } };
  h.cleared = []; h.written = []; h.clearOk = true;
});

describe("revertDroppedNudge", () => {
  it("clears the stamp so the counsellor can send again today", async () => {
    const r = await revertDroppedNudge("919886098754", at(AT), REASON);
    expect(r.reverted).toBe("A");
    expect(h.cleared).toEqual([{ phone: "919886098754", keys: [attrFor("A")] }]);
  });

  it("records WHY, so a vanished stamp is explainable", async () => {
    await revertDroppedNudge("919886098754", at(AT), REASON);
    const attrs = h.written[0].attrs;
    expect(attrs[DROP_REASON_ATTR]).toContain("healthy ecosystem engagement");
    expect(attrs[DROP_NUDGE_ATTR]).toBe("A");
  });

  it("writes to the phone the contact is STORED under, not the one passed in", async () => {
    // LeadSquared and Meta disagree about country codes; the read is
    // suffix-aware and the write must follow it, or the update silently
    // matches nothing. That combination lost a whole run's drip log once.
    h.contact = { phone: "919886098754", attributes: { [attrFor("A")]: AT } };
    await revertDroppedNudge("9886098754", at(AT), REASON);
    expect(h.cleared[0].phone).toBe("919886098754");
  });

  it("does nothing for a lead we do not have", async () => {
    h.contact = null;
    expect((await revertDroppedNudge("919886098754", at(AT), REASON)).reverted).toBeNull();
    expect(h.cleared).toHaveLength(0);
  });

  it("does nothing when no stamp is near the failure", async () => {
    h.contact = { phone: "919886098754", attributes: { [attrFor("A")]: "2026-10-01T05:00:00.000Z" } };
    expect((await revertDroppedNudge("919886098754", at(AT), REASON)).reverted).toBeNull();
    expect(h.cleared).toHaveLength(0);
  });

  it("refuses an unusable phone before touching anything", async () => {
    expect((await revertDroppedNudge("123", at(AT), REASON)).reverted).toBeNull();
    expect(h.written).toHaveLength(0);
  });

  it("reports nothing reverted when the clear itself fails", async () => {
    h.clearOk = false;
    expect((await revertDroppedNudge("919886098754", at(AT), REASON)).reverted).toBeNull();
  });

  it("never throws — it runs inside a webhook Meta retries", async () => {
    h.contact = { phone: "919886098754", attributes: null as unknown as Record<string, string> };
    await expect(revertDroppedNudge("919886098754", at(AT), REASON)).resolves.toBeTruthy();
  });
});
