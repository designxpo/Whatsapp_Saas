import { describe, it, expect } from "vitest";
import { normalizeButtons, MAX_RULE_BUTTONS, normalizePublicReplies, pickPublicReply, MAX_PUBLIC_REPLIES } from "../igcomments";

describe("normalizeButtons", () => {
  it("keeps valid http(s) buttons and trims labels to 20 chars", () => {
    const out = normalizeButtons([
      { label: "  Download  ", url: "https://x.com/a" },
      { label: "x".repeat(30), url: "http://y.com" },
    ]);
    expect(out).toEqual([
      { label: "Download", url: "https://x.com/a" },
      { label: "x".repeat(20), url: "http://y.com" },
    ]);
  });

  it("drops buttons without a valid http(s) url", () => {
    const out = normalizeButtons([
      { label: "ok", url: "https://ok.com" },
      { label: "bad", url: "ftp://nope" },
      { label: "empty", url: "" },
      { label: "relative", url: "/path" },
    ]);
    expect(out).toEqual([{ label: "ok", url: "https://ok.com" }]);
  });

  it(`caps at ${MAX_RULE_BUTTONS} buttons`, () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ label: `b${i}`, url: `https://x.com/${i}` }));
    expect(normalizeButtons(many)).toHaveLength(MAX_RULE_BUTTONS);
  });

  it("returns [] for non-array / junk input", () => {
    expect(normalizeButtons(null)).toEqual([]);
    expect(normalizeButtons(undefined)).toEqual([]);
    expect(normalizeButtons("nope")).toEqual([]);
    expect(normalizeButtons([{}, { url: 5 }])).toEqual([]);
  });
});

describe("normalizePublicReplies", () => {
  it("trims, drops blanks, and de-dupes", () => {
    expect(normalizePublicReplies(["  Sent you a DM!  ", "", "Sent you a DM!", "Check inbox"]))
      .toEqual(["Sent you a DM!", "Check inbox"]);
  });

  it(`caps at ${MAX_PUBLIC_REPLIES} variants`, () => {
    const many = Array.from({ length: 9 }, (_, i) => `reply ${i}`);
    expect(normalizePublicReplies(many)).toHaveLength(MAX_PUBLIC_REPLIES);
  });

  it("returns [] for junk input", () => {
    expect(normalizePublicReplies(null)).toEqual([]);
    expect(normalizePublicReplies("nope")).toEqual([]);
    expect(normalizePublicReplies([" ", "\t"])).toEqual([]);
  });
});

describe("pickPublicReply", () => {
  it("always returns one of the configured variants", () => {
    const rule = { publicReplies: ["a", "b", "c"], publicReply: null };
    for (let i = 0; i < 30; i++) expect(rule.publicReplies).toContain(pickPublicReply(rule));
  });

  it("falls back to the legacy single reply", () => {
    expect(pickPublicReply({ publicReplies: [], publicReply: "legacy" })).toBe("legacy");
  });

  it("returns '' when nothing is configured", () => {
    expect(pickPublicReply({ publicReplies: [], publicReply: null })).toBe("");
  });
});
