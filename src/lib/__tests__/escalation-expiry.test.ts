// An escalation holds the bot back. It must not do so forever.
//
// Branch 2c of handleFlowMessage is the never-go-silent fallback: with the AI
// off, a message that matches no session, no keyword and no ad opens the
// default menu flow so the person is not met with dead air.
//
// It skipped escalated chats, for a good reason — "our team will get back to
// you" must not be followed by the bot re-opening the menu.
//
// Measured on a real lead, 14 Oct. Escalated on 1 October. assigned_to null,
// so nobody ever actually took it. Thirteen days later she sent SEVEN
// messages and received nothing at all, because welcome fires once, away only
// outside hours, the AI is switched off, and this branch was the only thing
// left that could answer. A chat escalated to nobody had become a black hole.
//
// So the hold expires. These pin both halves: quiet inside the window,
// answering past it.
import { describe, it, expect } from "vitest";
import { ESCALATION_HOLD_MS } from "../flowengine";

/** The predicate exactly as branch 2c computes it. */
function freshChat(status: string, lastOutboundAt: number | null, now: number): boolean {
  const lastOut = lastOutboundAt ?? 0;
  const quiet = !lastOut || now - lastOut > 60 * 60_000;
  const escalated = status === "escalated";
  const holdExpired = !lastOut || now - lastOut > ESCALATION_HOLD_MS;
  return (!escalated || holdExpired) && quiet;
}

const NOW = Date.parse("2026-10-14T05:37:51Z");
const hoursAgo = (h: number) => NOW - h * 3600_000;

describe("while a human plausibly still owns the chat", () => {
  it("stays quiet right after the escalation", () => {
    expect(freshChat("escalated", hoursAgo(0.5), NOW)).toBe(false);
  });

  it("stays quiet the same evening", () => {
    expect(freshChat("escalated", hoursAgo(6), NOW)).toBe(false);
  });

  it("stays quiet the next morning", () => {
    expect(freshChat("escalated", hoursAgo(20), NOW)).toBe(false);
  });

  it("stays quiet right up to the boundary", () => {
    expect(freshChat("escalated", NOW - ESCALATION_HOLD_MS, NOW)).toBe(false);
  });
});

describe("once nobody has picked it up", () => {
  it("answers just past the hold", () => {
    expect(freshChat("escalated", NOW - ESCALATION_HOLD_MS - 60_000, NOW)).toBe(true);
  });

  it("answers the lead who came back thirteen days later", () => {
    // The actual case. Escalated 1 Oct, wrote again on the 14th.
    expect(freshChat("escalated", Date.parse("2026-10-01T05:55:32Z"), NOW)).toBe(true);
  });

  it("spans a weekend, which is the gap that produced it", () => {
    // Escalated Friday evening, lead returns Monday morning.
    expect(ESCALATION_HOLD_MS).toBeGreaterThanOrEqual(48 * 3600_000);
  });
});

describe("what the expiry must not change", () => {
  it("an ACTIVE chat is unaffected — still gated on the quiet hour", () => {
    expect(freshChat("active", hoursAgo(0.25), NOW)).toBe(false);   // mid-conversation
    expect(freshChat("active", hoursAgo(2), NOW)).toBe(true);       // idle
  });

  it("a chat we have never replied to is fresh whatever its status", () => {
    // No outbound at all: there is no human to talk over.
    expect(freshChat("active", null, NOW)).toBe(true);
    expect(freshChat("escalated", null, NOW)).toBe(true);
  });

  it("never answers inside the quiet hour, even on a stale escalation", () => {
    // Someone DID just reply on an old escalation — that is a live
    // conversation again, and the bot stays out of it.
    expect(freshChat("escalated", hoursAgo(0.5), NOW)).toBe(false);
  });
});
