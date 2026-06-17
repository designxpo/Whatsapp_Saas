import { describe, it, expect } from "vitest";
import { templateIssues } from "../preflight";

const body = (text: string) => ({ type: "BODY", text });

describe("templateIssues", () => {
  it("passes a plain approved template with all values", () => {
    const tpl = { name: "welcome", status: "APPROVED", components: [body("Hi {{1}}")] };
    const r = templateIssues(tpl, { bodyParams: ["Asha"] }, "broadcast");
    expect(r.blocking).toHaveLength(0);
  });

  it("blocks a carousel template in a broadcast with a clear message", () => {
    const tpl = { name: "testing_template", status: "APPROVED", components: [body("…"), { type: "CAROUSEL", cards: [{}, {}] }] };
    const r = templateIssues(tpl, {}, "broadcast");
    expect(r.blocking).toHaveLength(1);
    expect(r.blocking[0]).toMatch(/carousel/i);
    expect(r.blocking[0]).not.toMatch(/error|exception|HTTP|undefined/i); // plain English, not technical
  });

  it("blocks a carousel in a flow until it has 2+ cards, then passes", () => {
    const tpl = { name: "promo", status: "APPROVED", components: [{ type: "CAROUSEL", cards: [{}, {}] }] };
    expect(templateIssues(tpl, { cards: [{}] }, "flow").blocking).toHaveLength(1);
    expect(templateIssues(tpl, { cards: [{}, {}] }, "flow").blocking).toHaveLength(0);
  });

  it("blocks when body placeholders are unfilled", () => {
    const tpl = { name: "offer", status: "APPROVED", components: [body("Hi {{1}}, your {{2}} is ready")] };
    const r = templateIssues(tpl, { bodyParams: ["Asha"] }, "broadcast");
    expect(r.blocking[0]).toMatch(/2 values/);
  });

  it("blocks when a media header has no link", () => {
    const tpl = { name: "banner", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, body("hello")] };
    expect(templateIssues(tpl, {}, "broadcast").blocking[0]).toMatch(/image header/i);
    expect(templateIssues(tpl, { headerImageUrl: "https://x/y.jpg" }, "broadcast").blocking).toHaveLength(0);
  });

  it("blocks an unapproved template", () => {
    const tpl = { name: "draft1", status: "PENDING", components: [body("hi")] };
    expect(templateIssues(tpl, {}, "broadcast").blocking[0]).toMatch(/approved/i);
  });

  it("blocks a missing template", () => {
    expect(templateIssues(null).blocking).toHaveLength(1);
  });
});
