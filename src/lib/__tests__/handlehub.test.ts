import { describe, it, expect } from "vitest";
import { parseRef, stripRef, trackedLink, REF_RE } from "../handlehub";

// Handle Hub attribution loop, current format: a tracked link embeds its ref
// code as INVISIBLE zero-width characters after the greeting — the customer's
// prefilled (and sent) message reads completely clean, nothing bracketed. On
// inbound the webhook must recover that exact code and strip the payload so
// the stored/answered message is the customer's real, visible text.
describe("Handle Hub — invisible ref encoding", () => {
  it("builds a wa.me link whose VISIBLE text is exactly the greeting — nothing bracketed", () => {
    const link = trackedLink({ number: "919555219007", handle: "analytixlabs", greeting: "Hi! I'd like to know more." }, { refCode: "ab12cd" });
    expect(link).toContain("https://wa.me/919555219007?text=");
    const prefilled = decodeURIComponent(link!.split("text=")[1]);
    expect(prefilled).not.toContain("[");
    expect(prefilled).not.toContain("ref");
    expect(prefilled.replace(/[\u200B\u200C\u200D]/g, "")).toBe("Hi! I'd like to know more.");
  });

  it("returns null when no number is configured", () => {
    expect(trackedLink({ number: "", handle: "x", greeting: "Hi" }, { refCode: "ab12cd" })).toBeNull();
  });

  it("round-trips: the code minted into a link is exactly what parseRef recovers, and stripRef leaves the greeting untouched", () => {
    const cfg = { number: "919555219007", handle: "x", greeting: "Hello!" };
    const link = trackedLink(cfg, { refCode: "k7m2q9" })!;
    const prefilled = decodeURIComponent(link.split("text=")[1]);   // what WhatsApp sends as msg 1
    expect(parseRef(prefilled)).toBe("k7m2q9");
    expect(stripRef(prefilled)).toBe("Hello!");
  });

  it("round-trips codes of varying length (genCode doesn't always yield exactly 7 chars)", () => {
    for (const code of ["a", "ab12", "z9x8w7v6", "0123456789abcdef"]) {
      const link = trackedLink({ number: "919555219007", handle: "", greeting: "Hi" }, { refCode: code })!;
      const prefilled = decodeURIComponent(link.split("text=")[1]);
      expect(parseRef(prefilled)).toBe(code);
    }
  });

  it("degrades gracefully when the customer edits the prefilled text away — unattributed, not broken", () => {
    expect(parseRef("hi, just curious about pricing")).toBeNull();
    expect(stripRef("hi, just curious about pricing")).toBe("hi, just curious about pricing");
  });

  it("still recognizes the legacy visible [ref:CODE]/(ref:CODE) format for links already handed out", () => {
    expect(parseRef("Hi there [ref:ab12cd]")).toBe("ab12cd");
    expect(parseRef("Hello (REF: XY99Z)")).toBe("xy99z");
    expect(stripRef("Hi! I'd like to know more. [ref:ab12cd]")).toBe("Hi! I'd like to know more.");
    expect(stripRef("Interested  [ref:zzzz]  in the course")).toBe("Interested in the course");
  });

  it("REF_RE (legacy format) ignores a code that's too short/long (avoids false positives)", () => {
    expect(parseRef("[ref:ab]")).toBeNull();                 // < 4 chars
    expect(parseRef("[ref:abcdef0123456789xyz]")).toBeNull(); // > 16 chars
    expect(REF_RE.test("[ref:abcd]")).toBe(true);
  });
});
