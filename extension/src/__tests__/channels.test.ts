import { describe, it, expect } from "vitest";
import { CHANNELS, channelMeta, isReplyable, relativeTime, windowStatus } from "../channels.js";

// These strings are what an agent reads before deciding how to answer. A wrong
// channel label sends them to the wrong place; a wrong window state makes them
// try a free-form reply that WhatsApp will refuse.

const HOUR = 3600_000;
const NOW = new Date("2026-08-14T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("channelMeta", () => {
  it("labels every channel the product supports", () => {
    expect(CHANNELS.map(c => c.id)).toEqual(["whatsapp", "instagram", "messenger", "webchat"]);
    expect(channelMeta("whatsapp")).toMatchObject({ label: "WhatsApp", short: "WA" });
    expect(channelMeta("instagram")).toMatchObject({ label: "Instagram", short: "IG" });
    expect(channelMeta("messenger")).toMatchObject({ label: "Messenger", short: "MSG" });
    // "webchat" is the internal name; an agent should read the plain word.
    expect(channelMeta("webchat")).toMatchObject({ label: "Website", short: "WEB" });
  });

  it("defaults a missing platform to WhatsApp, matching the API", () => {
    expect(channelMeta(undefined).id).toBe("whatsapp");
    expect(channelMeta(null).id).toBe("whatsapp");
  });

  it("degrades gracefully for a channel added server-side before the extension knows it", () => {
    expect(channelMeta("telegram")).toMatchObject({ label: "Telegram", short: "TEL" });
  });
});

describe("isReplyable", () => {
  it("allows WhatsApp only — the extension sends via the Cloud API", () => {
    expect(isReplyable("whatsapp")).toBe(true);
    expect(isReplyable(undefined)).toBe(true);
    for (const p of ["instagram", "messenger", "webchat"]) expect(isReplyable(p)).toBe(false);
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

  it("points non-WhatsApp chats at the portal instead of offering a send", () => {
    const s = windowStatus({ platform: "instagram", windowOpen: true, lastInboundAt: ago(HOUR) }, NOW);
    expect(s.state).toBe("other");
    expect(s.label).toBe("Instagram chat");
    expect(s.hint).toMatch(/portal/);
  });

  it("treats an empty conversation object as needing a template, never as sendable", () => {
    expect(windowStatus({}, NOW).state).toBe("none");
    expect(windowStatus(undefined, NOW).state).toBe("none");
  });
});
