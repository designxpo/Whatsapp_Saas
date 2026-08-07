import { describe, it, expect, vi, afterEach } from "vitest";
import { validateButtonParams, resolveVariables } from "@/lib/apirules";
import { dynamicUrlButtonIndexes } from "@/lib/whatsapp";

// Per-order deep links on template buttons — the "Track your delivery" pattern.
//
// Every failure mode here is one Meta rejects at SEND time rather than at
// configuration time, which is what made the original bug invisible: the rule
// looked correct in the portal and then failed for every single order.

describe("dynamicUrlButtonIndexes", () => {
  const tpl = (buttons: { type: string; text?: string; url?: string }[]) => ({
    components: [{ type: "BODY", text: "hi" }, { type: "BUTTONS", buttons }],
  });

  it("finds URL buttons carrying a placeholder, by button position", () => {
    expect(dynamicUrlButtonIndexes(tpl([
      { type: "QUICK_REPLY", text: "Contact support" },
      { type: "URL", text: "Track your delivery", url: "https://shop.com/track/{{1}}" },
    ]))).toEqual([1]);
  });

  it("ignores a fixed URL button — it takes no parameter", () => {
    expect(dynamicUrlButtonIndexes(tpl([
      { type: "URL", text: "Shop All Deals", url: "https://shop.com/deals" },
    ]))).toEqual([]);
  });

  it("handles several dynamic buttons and whitespace in the placeholder", () => {
    expect(dynamicUrlButtonIndexes(tpl([
      { type: "URL", text: "Order details", url: "https://shop.com/o/{{ 1 }}" },
      { type: "PHONE_NUMBER", text: "Call us" },
      { type: "URL", text: "Return", url: "https://shop.com/r/{{1}}" },
    ]))).toEqual([0, 2]);
  });

  it("returns nothing for a template with no buttons at all", () => {
    expect(dynamicUrlButtonIndexes({ components: [{ type: "BODY", text: "hi" }] })).toEqual([]);
  });
});

describe("validateButtonParams", () => {
  it("accepts a dynamic button with a value", () => {
    expect(validateButtonParams({ dynamicIndexes: [0], clickTracked: false, buttonUrlParams: ["{{payload.order_id}}"] })).toBeNull();
  });

  it("accepts a template with no dynamic buttons and no values", () => {
    expect(validateButtonParams({ dynamicIndexes: [], clickTracked: false, buttonUrlParams: [] })).toBeNull();
  });

  it("rejects a dynamic button left without a value — Meta would reject the send", () => {
    const err = validateButtonParams({ dynamicIndexes: [0], clickTracked: false, buttonUrlParams: [] });
    expect(err).toMatch(/dynamic URL button/i);
    expect(err).toContain("position 1");
  });

  it("rejects a blank value for a dynamic button, not just a missing one", () => {
    expect(validateButtonParams({ dynamicIndexes: [0], clickTracked: false, buttonUrlParams: ["   "] })).toMatch(/dynamic URL button/i);
  });

  it("reports every unfilled button, in human 1-based positions", () => {
    const err = validateButtonParams({ dynamicIndexes: [0, 2], clickTracked: false, buttonUrlParams: [] });
    expect(err).toContain("position 1, 3");
  });

  it("rejects a value aimed at a fixed button — Meta rejects that send too", () => {
    const err = validateButtonParams({ dynamicIndexes: [], clickTracked: false, buttonUrlParams: ["404-123"] });
    expect(err).toMatch(/fixed link/i);
    expect(err).toContain("Button 1");
  });

  it("rejects mixing click tracking with manual values — the tracking code owns that slot", () => {
    expect(validateButtonParams({ dynamicIndexes: [0], clickTracked: true, buttonUrlParams: ["{{payload.order_id}}"] }))
      .toMatch(/click tracking/i);
  });

  it("accepts a click-tracked template with no manual values", () => {
    expect(validateButtonParams({ dynamicIndexes: [0], clickTracked: true, buttonUrlParams: [] })).toBeNull();
  });

  it("keeps index alignment: a blank first entry does not satisfy the second button", () => {
    // ["", "x"] must fill button 2 only — button 1 is still missing.
    const err = validateButtonParams({ dynamicIndexes: [0, 1], clickTracked: false, buttonUrlParams: ["", "x"] });
    expect(err).toContain("position 1");
    expect(err).not.toContain("position 1, 2");
  });
});

describe("resolving a button value from the event payload", () => {
  const ctx = { payload: { order_id: "404-0952515-9776314", eta: 10 }, contact: null, phone: "919876543210", name: "Asha" };

  it("maps an order id out of the event payload", () => {
    expect(resolveVariables(["{{payload.order_id}}"], ctx)).toEqual(["404-0952515-9776314"]);
  });

  it("accepts a literal, for a button that always points at the same suffix", () => {
    expect(resolveVariables(["orders"], ctx)).toEqual(["orders"]);
  });

  it("yields an empty string for a token the payload doesn't have, rather than the raw token", () => {
    // Important: sending the literal "{{payload.missing}}" as a URL suffix would
    // produce a live but broken link. Empty is caught by the guard instead.
    expect(resolveVariables(["{{payload.missing}}"], ctx)).toEqual([""]);
  });
});

// ── The wire format ──────────────────────────────────────────────────────────
// What actually reaches Meta. A wrong sub_type or a numeric index silently
// fails, and no unit test above would notice.

vi.mock("@/lib/moderation", () => ({
  moderateText: async () => ({ allowed: true }),
  collectStrings: () => [],
}));

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

describe("sendTemplateSingle button component", () => {
  async function capture(buttonUrlParams?: (string | null)[]) {
    process.env.META_WA_ACCESS_TOKEN = "t";
    process.env.META_WA_PHONE_NUMBER_ID = "p";
    const spy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const { sendTemplateSingle } = await import("@/lib/whatsapp");
    await sendTemplateSingle("919876543210", "order_shipped", "en_US", ["Asha"], undefined, undefined, buttonUrlParams);
    return JSON.parse((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  }

  it("emits the documented button component shape", async () => {
    const body = await capture(["404-0952515-9776314"]);
    expect(body.template.components).toContainEqual({
      type: "button",
      sub_type: "url",
      index: "0",                              // Meta wants a STRING index
      parameters: [{ type: "text", text: "404-0952515-9776314" }],
    });
  });

  it("keeps the body component alongside it", async () => {
    const body = await capture(["404-1"]);
    expect(body.template.components).toContainEqual({ type: "body", parameters: [{ type: "text", text: "Asha" }] });
  });

  it("sends no button component when there are no values", async () => {
    const body = await capture();
    expect(JSON.stringify(body)).not.toContain("sub_type");
  });

  it("skips blank slots but keeps later indexes correct", async () => {
    // Button 1 fixed, button 2 dynamic → only index "1" may be sent.
    const body = await capture(["", "RET-99"]);
    const buttons = (body.template.components as Record<string, unknown>[]).filter(c => c.type === "button");
    expect(buttons).toEqual([{ type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "RET-99" }] }]);
  });
});
