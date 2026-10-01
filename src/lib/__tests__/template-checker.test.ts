// The template checker's rules.
//
// Worth pinning harder than most UI logic because this tool gives advice to
// strangers on a public page. A false positive sends someone rewriting a
// perfectly good template; a false negative lets them submit one that gets
// rejected and tells them the structure was fine. Every rule below maps to a
// documented Meta rejection cause, cited in the post's source list.

import { describe, it, expect } from "vitest";
import { checkTemplate } from "../whatsapp-template-rules";

const check = (body: string, header = "", footer = "") => checkTemplate({ header, body, footer });
const failures = (body: string, header = "", footer = "") => check(body, header, footer).filter(f => !f.ok);
const failed = (title: string, body: string, header = "", footer = "") =>
  failures(body, header, footer).some(f => f.title.toLowerCase().includes(title.toLowerCase()));

describe("checkTemplate — a clean template", () => {
  it("passes a well-formed body with no complaints", () => {
    expect(failures("Hi {{1}}, your order {{2}} ships today from our {{3}} warehouse.")).toEqual([]);
  });

  it("passes a template with no variables at all", () => {
    expect(failures("Your order has shipped and should arrive tomorrow.")).toEqual([]);
  });
});

describe("checkTemplate — variable rules", () => {
  it("catches a gap in the numbering", () => {
    expect(failed("not sequential", "Hi {{1}}, your order {{3}} ships today from here.")).toBe(true);
  });

  it("catches a body that opens on a variable", () => {
    expect(failed("start", "{{1}}, your order ships today from our warehouse.")).toBe(true);
  });

  it("catches a body that ends on a variable", () => {
    expect(failed("end", "Your order ships today from our warehouse in {{1}}")).toBe(true);
  });

  it("catches two variables with nothing between them", () => {
    expect(failed("side by side", "Hi there, your order {{1}}{{2}} ships today from our warehouse.")).toBe(true);
  });

  it("catches a template that is mostly placeholders", () => {
    // Five variables, four words of copy — the "abuse potential" rejection.
    expect(failed("too many variables", "Hi {{1}} {{2}} {{3}} {{4}} order {{5}} now.")).toBe(true);
  });

  it("catches malformed braces", () => {
    expect(failed("braces", "Hi {{1}, your order ships today from our warehouse.")).toBe(true);
    expect(failed("braces", "Hi {{name}}, your order ships today from our warehouse.")).toBe(true);
  });

  it("does not flag a correct template as having a brace problem", () => {
    expect(failed("braces", "Hi {{1}}, your order {{2}} ships today from our warehouse.")).toBe(false);
  });
});

describe("checkTemplate — length and whitespace", () => {
  it("catches a body over 1,024 characters", () => {
    expect(failed("body is over", "a".repeat(1025))).toBe(true);
    expect(failed("body is over", "a".repeat(1024))).toBe(false);
  });

  it("catches a header over 60 characters", () => {
    expect(failed("header is over", "Your order ships today.", "h".repeat(61))).toBe(true);
    expect(failed("header is over", "Your order ships today.", "h".repeat(60))).toBe(false);
  });

  it("catches a footer over 60 characters", () => {
    expect(failed("footer is over", "Your order ships today.", "", "f".repeat(61))).toBe(true);
  });

  it("catches a variable in the footer, which takes none", () => {
    // The body directly above accepts variables, so this reads as obviously
    // fine and is rejected every time.
    expect(failed("variable in the footer", "Your order ships today.", "", "Reply STOP {{1}}")).toBe(true);
    expect(failed("variable in the footer", "Your order ships today.", "", "Reply STOP to opt out")).toBe(false);
  });

  it("catches tabs and long space runs pasted in from a document", () => {
    expect(failed("tabs", "Your order\tships today from our warehouse.")).toBe(true);
    expect(failed("tabs", "Your order     ships today from our warehouse.")).toBe(true);
    // Four spaces is the documented ceiling, so four must still pass.
    expect(failed("tabs", "Your order    ships today from our warehouse.")).toBe(false);
  });

  it("ignores an empty header and footer rather than reporting on them", () => {
    const titles = check("Your order ships today.").map(f => f.title);
    expect(titles.some(t => t.toLowerCase().includes("header"))).toBe(false);
    expect(titles.some(t => t.toLowerCase().includes("footer"))).toBe(false);
  });
});

describe("checkTemplate — the sample it ships with", () => {
  it("the default example genuinely breaks the rules it claims to", () => {
    // The widget loads pre-filled with a deliberately broken template, so a
    // first-time visitor sees it doing something. If that sample ever stopped
    // failing, the tool would look broken on arrival.
    const f = failures("{{1}}, your order {{2}}{{3}} is out for delivery and should reach you today.", "Order update", "Reply STOP to opt out {{4}}");
    expect(f.length).toBeGreaterThanOrEqual(3);
  });
});
