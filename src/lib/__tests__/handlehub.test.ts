import { describe, it, expect } from "vitest";
import { parseRef, stripRef, trackedLink, REF_RE } from "../handlehub";

// Handle Hub attribution loop: a tracked link embeds "[ref:CODE]" in the wa.me
// prefilled text; on inbound the webhook must recover that exact code and strip
// the token so the stored/answered message is the customer's real text.
describe("Handle Hub — ref token", () => {
  it("parses [ref:code] and (ref:code), case-insensitively", () => {
    expect(parseRef("Hi there [ref:ab12cd]")).toBe("ab12cd");
    expect(parseRef("Hello (REF: XY99Z)")).toBe("xy99z");
    expect(parseRef("no token here")).toBeNull();
    expect(parseRef("")).toBeNull();
  });

  it("strips the token and tidies whitespace, keeping the real message", () => {
    expect(stripRef("Hi! I'd like to know more. [ref:ab12cd]")).toBe("Hi! I'd like to know more.");
    expect(stripRef("Interested  [ref:zzzz]  in the course")).toBe("Interested in the course");
    expect(stripRef("no token")).toBe("no token");
  });

  it("builds a wa.me tracked link with the greeting + token, url-encoded", () => {
    const link = trackedLink({ number: "919555219007", handle: "analytixlabs", greeting: "Hi! I'd like to know more." }, { refCode: "ab12cd" });
    expect(link).toContain("https://wa.me/919555219007?text=");
    expect(decodeURIComponent(link!.split("text=")[1])).toBe("Hi! I'd like to know more. [ref:ab12cd]");
  });

  it("returns null when no number is configured", () => {
    expect(trackedLink({ number: "", handle: "x", greeting: "Hi" }, { refCode: "ab12cd" })).toBeNull();
  });

  it("round-trips: the code minted into a link is exactly what parseRef recovers", () => {
    const cfg = { number: "919555219007", handle: "x", greeting: "Hello!" };
    const link = trackedLink(cfg, { refCode: "k7m2q9" })!;
    const prefilled = decodeURIComponent(link.split("text=")[1]);   // what WhatsApp sends as msg 1
    expect(parseRef(prefilled)).toBe("k7m2q9");
    expect(stripRef(prefilled)).toBe("Hello!");
  });

  it("REF_RE ignores a code that's too short/long (avoids false positives)", () => {
    expect(parseRef("[ref:ab]")).toBeNull();                 // < 4 chars
    expect(parseRef("[ref:abcdef0123456789xyz]")).toBeNull(); // > 16 chars
    expect(REF_RE.test("[ref:abcd]")).toBe(true);
  });
});
