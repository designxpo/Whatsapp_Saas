import { describe, it, expect } from "vitest";
import { CHANNELS, STATUS_FILTERS, channelMeta, supportsTemplates, hasWindow, relativeTime, windowStatus } from "../channels.js";

// These strings are what an agent reads before deciding how to answer. A wrong
// channel label sends them to the wrong place; a wrong window state makes them
// try a free-form reply that WhatsApp will refuse.

const HOUR = 3600_000;
const NOW = new Date("2026-08-14T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("channelMeta", () => {
  // The labels must match the portal's Live Chat exactly — the same channel
  // called two different names across the product is a support ticket.
  it("labels every channel the way the portal does", () => {
    expect(CHANNELS.map(c => c.id)).toEqual(["whatsapp", "instagram", "messenger", "webchat"]);
    expect(channelMeta("whatsapp")).toMatchObject({ label: "WhatsApp", short: "WA" });
    expect(channelMeta("instagram")).toMatchObject({ label: "Instagram", short: "IG" });
    // Internally "messenger"/"webchat"; the portal shows Facebook / Web chat.
    expect(channelMeta("messenger")).toMatchObject({ label: "Facebook", short: "FB" });
    expect(channelMeta("webchat")).toMatchObject({ label: "Web chat", short: "WEB" });
  });

  it("defaults a missing platform to WhatsApp, matching the API", () => {
    expect(channelMeta(undefined).id).toBe("whatsapp");
    expect(channelMeta(null).id).toBe("whatsapp");
  });

  it("degrades gracefully for a channel added server-side before the extension knows it", () => {
    expect(channelMeta("telegram")).toMatchObject({ label: "Telegram", short: "TEL" });
  });
});

describe("STATUS_FILTERS", () => {
  it("offers the same statuses as the portal's Live Chat, same wording", () => {
    expect(STATUS_FILTERS).toEqual([
      { id: "all", label: "All" },
      { id: "needs_reply", label: "Needs reply" },
      { id: "escalated", label: "Escalated" },
      // The portal calls a bot-off chat "Human" — a person is handling it.
      { id: "bot_off", label: "Human" },
    ]);
  });
});

describe("supportsTemplates", () => {
  // A template is the only way to reopen a closed chat, and only WhatsApp has
  // them. Getting this wrong would offer a template picker on a channel where
  // the send is guaranteed to fail.
  it("is WhatsApp-only", () => {
    expect(supportsTemplates("whatsapp")).toBe(true);
    expect(supportsTemplates(undefined)).toBe(true);
    for (const p of ["instagram", "messenger", "webchat"]) expect(supportsTemplates(p)).toBe(false);
  });
});

describe("hasWindow", () => {
  it("applies the 24h window everywhere except web chat", () => {
    for (const p of ["whatsapp", "instagram", "messenger"]) expect(hasWindow(p)).toBe(true);
    expect(hasWindow("webchat")).toBe(false);
  });
});

describe("relativeTime", () => {
  it("reads as a compact age", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("now");
    expect(relativeTime(ago(6 * 60_000), NOW)).toBe("6m");
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe("3h");
    expect(relativeTime(ago(2 * 24 * HOUR), NOW)).toBe("2d");
    expect(relativeTime(ago(9 * 24 * HOUR), NOW)).toBe("1w");
  });

  it("is blank for a chat that has never had a message", () => {
    expect(relativeTime(null, NOW)).toBe("");
  });
});

describe("windowStatus", () => {
  it("says how long is left while the 24h window is open", () => {
    const s = windowStatus({ windowOpen: true, lastInboundAt: ago(2 * HOUR), windowClosesAt: new Date(NOW + 22 * HOUR).toISOString() }, NOW);
    expect(s.state).toBe("open");
    expect(s.label).toBe("Can reply · 22h left");
  });

  it("switches to minutes in the last hour", () => {
    const s = windowStatus({ windowOpen: true, lastInboundAt: ago(23.5 * HOUR), windowClosesAt: new Date(NOW + 30 * 60_000).toISOString() }, NOW);
    expect(s.label).toBe("Can reply · 30m left");
  });

  it("says closing now rather than 0m left", () => {
    const s = windowStatus({ windowOpen: true, lastInboundAt: ago(24 * HOUR), windowClosesAt: new Date(NOW + 10_000).toISOString() }, NOW);
    expect(s.label).toBe("Can reply · closing now");
  });

  it("derives the deadline from lastInboundAt when the API omits it", () => {
    const s = windowStatus({ windowOpen: true, lastInboundAt: ago(4 * HOUR) }, NOW);
    expect(s.label).toBe("Can reply · 20h left");
  });

  it("demands a template once the window has closed, and explains why", () => {
    const s = windowStatus({ windowOpen: false, lastInboundAt: ago(48 * HOUR) }, NOW);
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Template needed");
    expect(s.hint).toMatch(/24 hours/);
  });

  it("demands a template when the contact has never messaged first", () => {
    const s = windowStatus({ windowOpen: false, lastInboundAt: null }, NOW);
    expect(s.state).toBe("none");
    expect(s.label).toBe("Template needed");
    expect(s.hint).toMatch(/hasn't messaged/);
  });

  it("lets an agent reply on Instagram inside its own 24h window", () => {
    const s = windowStatus({ platform: "instagram", windowOpen: true, lastInboundAt: ago(HOUR) }, NOW);
    expect(s.state).toBe("open");
    expect(s.label).toBe("Can reply · 23h left");
  });

  // Meta gives a HUMAN agent 7 days on IG/Facebook, so a 2-day-old DM is still
  // answerable — reporting it as closed would block real work for no reason.
  it("keeps an Instagram chat repliable for 7 days under the human-agent window", () => {
    const s = windowStatus({ platform: "instagram", windowOpen: false, lastInboundAt: ago(2 * 24 * HOUR) }, NOW);
    expect(s.state).toBe("open");
    expect(s.label).toBe("Can reply · 5d left");
    expect(s.hint).toMatch(/lets a person reply for 7 days/);
  });

  it("still shows hours, not days, inside the first 24h on Instagram", () => {
    expect(windowStatus({ platform: "instagram", windowOpen: true, lastInboundAt: ago(2 * HOUR) }, NOW).label)
      .toBe("Can reply · 22h left");
  });

  it("closes Instagram/Facebook only after the 7 days are up", () => {
    const s = windowStatus({ platform: "instagram", windowOpen: false, lastInboundAt: ago(8 * 24 * HOUR) }, NOW);
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Waiting on them");
    expect(s.hint).toMatch(/over 7 days/);
    expect(windowStatus({ platform: "messenger", windowOpen: false, lastInboundAt: ago(10 * 24 * HOUR) }, NOW).label).toBe("Waiting on them");
  });

  it("still refuses to start a cold chat on Facebook", () => {
    const cold = windowStatus({ platform: "messenger", lastInboundAt: null }, NOW);
    expect(cold.state).toBe("none");
    expect(cold.hint).toMatch(/Facebook doesn't allow starting a chat/);
  });

  // WhatsApp has no human-agent extension — 24h then templates only.
  it("does not give WhatsApp the 7-day window", () => {
    const s = windowStatus({ platform: "whatsapp", windowOpen: false, lastInboundAt: ago(2 * 24 * HOUR) }, NOW);
    expect(s.state).toBe("closed");
    expect(s.label).toBe("Template needed");
  });

  it("treats web chat as always repliable — it has no messaging window", () => {
    for (const conv of [
      { platform: "webchat", windowOpen: false, lastInboundAt: ago(90 * 24 * HOUR) },
      { platform: "webchat", lastInboundAt: null },
    ]) {
      const s = windowStatus(conv, NOW);
      expect(s.state).toBe("open");
      expect(s.label).toBe("Can reply");
      expect(s.hint).toMatch(/no time limit/);
    }
  });

  it("treats an empty conversation object as needing a template, never as sendable", () => {
    expect(windowStatus({}, NOW).state).toBe("none");
    expect(windowStatus(undefined, NOW).state).toBe("none");
  });
});
