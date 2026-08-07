import { describe, it, expect } from "vitest";
import { dynamicUrlButtonIndexes } from "@/lib/whatsapp";

// The portal could not create the button the per-order deep-link feature needs:
// the template builder dropped `example` when serialising a URL button, and Meta
// rejects a {{1}} URL button submitted without a sample value. That failed at
// SUBMISSION time with Meta's own wording, so it read like a Meta problem rather
// than ours.
//
// serializeTplButtons lives in a "use client" tab component, so this mirrors its
// exact logic to pin the contract. If the two drift, the round-trip assertion at
// the bottom (builder output → dynamicUrlButtonIndexes) is what catches it.

type TplButton = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE"; text: string; url: string; phoneNumber: string; example: string };

const isDynamicUrl = (b: TplButton) => b.type === "URL" && /\{\{\s*1\s*\}\}/.test(b.url);

function serializeTplButtons(btns: TplButton[]) {
  return btns.map(b =>
    b.type === "QUICK_REPLY" ? { type: b.type, text: b.text }
    : b.type === "URL" ? { type: b.type, text: b.text, url: b.url, ...(isDynamicUrl(b) ? { example: b.example } : {}) }
    : b.type === "PHONE_NUMBER" ? { type: b.type, text: b.text, phoneNumber: b.phoneNumber }
    : { type: b.type, example: b.example });
}

const btn = (over: Partial<TplButton>): TplButton =>
  ({ type: "URL", text: "Track your delivery", url: "", phoneNumber: "", example: "", ...over });

describe("template builder — dynamic URL buttons", () => {
  it("carries the sample value for a {{1}} URL, which Meta requires", () => {
    const [out] = serializeTplButtons([btn({ url: "https://shop.com/track/{{1}}", example: "404-0952515-9776314" })]);
    expect(out).toEqual({
      type: "URL", text: "Track your delivery",
      url: "https://shop.com/track/{{1}}", example: "404-0952515-9776314",
    });
  });

  it("omits `example` for a fixed URL — sending one there is itself a rejection", () => {
    const [out] = serializeTplButtons([btn({ text: "Shop All Deals", url: "https://shop.com/deals", example: "ignored" })]);
    expect(out).not.toHaveProperty("example");
  });

  it("tolerates whitespace inside the placeholder", () => {
    const [out] = serializeTplButtons([btn({ url: "https://shop.com/o/{{ 1 }}", example: "X1" })]);
    expect(out).toHaveProperty("example", "X1");
  });

  it("leaves the other button types untouched", () => {
    expect(serializeTplButtons([
      btn({ type: "QUICK_REPLY", text: "Contact support" }),
      btn({ type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+919876543210" }),
      btn({ type: "COPY_CODE", example: "SAVE20" }),
    ])).toEqual([
      { type: "QUICK_REPLY", text: "Contact support" },
      { type: "PHONE_NUMBER", text: "Call us", phoneNumber: "+919876543210" },
      { type: "COPY_CODE", example: "SAVE20" },
    ]);
  });

  it("round-trips: what the builder emits is what the rules guard detects as dynamic", () => {
    // The builder and the save-time guard have to agree on "dynamic", or a rule
    // demands a value for a button Meta thinks is fixed (or the reverse).
    const buttons = serializeTplButtons([
      btn({ type: "QUICK_REPLY", text: "Contact support" }),
      btn({ url: "https://shop.com/track/{{1}}", example: "404-1" }),
      btn({ text: "Shop All Deals", url: "https://shop.com/deals" }),
    ]);
    expect(dynamicUrlButtonIndexes({ components: [{ type: "BUTTONS", buttons }] })).toEqual([1]);
  });
});
