import { describe, it, expect } from "vitest";
import {
  signPayload, humanText, buildWebhookRequest, isIntegrationEvent,
  splitName, hubspotContactProps, pipedrivePersonBody,
  normalizeShop, wooBase, toCents, mapShopifyProduct, mapWooProduct,
  parseCalcomSlots, matchSlot, extractEmail, formatSlotLabel,
  type EventEnvelope,
} from "../integrations";

const env = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: "d1", event: "message.inbound", occurredAt: "2026-06-17T00:00:00.000Z",
  tenant: "t1", data: { phone: "+15551234567", name: "Asha", text: "hi there" },
  ...over,
});

describe("signPayload", () => {
  it("is a deterministic sha256= hex digest", () => {
    const a = signPayload("secret", "body");
    const b = signPayload("secret", "body");
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
  it("changes with the secret and with the body", () => {
    expect(signPayload("s1", "body")).not.toBe(signPayload("s2", "body"));
    expect(signPayload("s1", "a")).not.toBe(signPayload("s1", "b"));
  });
});

describe("humanText", () => {
  it("summarizes each event with the contact's name", () => {
    expect(humanText("message.inbound", { name: "Asha", text: "hello" })).toContain("Asha");
    expect(humanText("conversation.escalated", { name: "Asha", reason: "refund" })).toMatch(/needs a human/i);
    expect(humanText("order.created", { orderId: "o9", phone: "+1" })).toContain("o9");
    expect(humanText("contact.optout", { phone: "+1" })).toMatch(/opted out/i);
  });
  it("falls back to phone, then to a generic noun", () => {
    expect(humanText("message.inbound", { phone: "+1999", text: "x" })).toContain("+1999");
    expect(humanText("message.inbound", { text: "x" })).toContain("a contact");
  });
  it("truncates very long inbound text", () => {
    const long = "x".repeat(1000);
    expect(humanText("message.inbound", { name: "A", text: long }).length).toBeLessThan(400);
  });
});

describe("buildWebhookRequest", () => {
  it("generic format sends the full envelope and a signature", () => {
    const { body, headers } = buildWebhookRequest({ format: "generic", secret: "sek", envelope: env() });
    expect(JSON.parse(body).event).toBe("message.inbound");
    expect(JSON.parse(body).data.name).toBe("Asha");
    expect(headers["X-Alabs-Signature"]).toBe(signPayload("sek", body));
    expect(headers["X-Alabs-Event"]).toBe("message.inbound");
    expect(headers["X-Alabs-Delivery"]).toBe("d1");
  });
  it("slack format sends only {text} and is NOT signed", () => {
    const { body, headers } = buildWebhookRequest({ format: "slack", secret: "sek", envelope: env() });
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed)).toEqual(["text"]);
    expect(parsed.text).toContain("Asha");
    expect(headers["X-Alabs-Signature"]).toBeUndefined();
  });
  it("teams format also uses {text}", () => {
    const { body } = buildWebhookRequest({ format: "teams", secret: null, envelope: env({ event: "order.created", data: { orderId: "o1", phone: "+1" } }) });
    expect(JSON.parse(body).text).toContain("o1");
  });
  it("omits the signature when there is no secret", () => {
    const { headers } = buildWebhookRequest({ format: "generic", secret: null, envelope: env() });
    expect(headers["X-Alabs-Signature"]).toBeUndefined();
  });
});

describe("isIntegrationEvent", () => {
  it("accepts known events and rejects others", () => {
    expect(isIntegrationEvent("message.inbound")).toBe(true);
    expect(isIntegrationEvent("contact.created")).toBe(true);
    expect(isIntegrationEvent("order.created")).toBe(true);
    expect(isIntegrationEvent("nope")).toBe(false);
  });
});

describe("splitName", () => {
  it("splits first and last", () => {
    expect(splitName("Asha Verma")).toEqual({ first: "Asha", last: "Verma" });
    expect(splitName("Asha")).toEqual({ first: "Asha", last: "" });
    expect(splitName("Asha Devi Verma")).toEqual({ first: "Asha", last: "Devi Verma" });
    expect(splitName(undefined)).toEqual({ first: "", last: "" });
  });
});

describe("hubspotContactProps", () => {
  it("maps phone + name to HubSpot properties", () => {
    const p = hubspotContactProps({ phone: "+15551234567", name: "Asha Verma", channel: "whatsapp" });
    expect(p.phone).toBe("+15551234567");
    expect(p.firstname).toBe("Asha");
    expect(p.lastname).toBe("Verma");
    expect(p.lifecyclestage).toBe("lead");
  });
  it("omits name fields when there is no name", () => {
    const p = hubspotContactProps({ phone: "+1" });
    expect(p.phone).toBe("+1");
    expect(p.firstname).toBeUndefined();
    expect(p.lastname).toBeUndefined();
  });
});

describe("pipedrivePersonBody", () => {
  it("builds a person with a primary phone", () => {
    const b = pipedrivePersonBody({ phone: "+15551234567", name: "Asha" }) as { name: string; phone: { value: string; primary: boolean }[] };
    expect(b.name).toBe("Asha");
    expect(b.phone[0]).toMatchObject({ value: "+15551234567", primary: true });
  });
  it("falls back to the phone, then a generic name", () => {
    expect((pipedrivePersonBody({ phone: "+199" }) as { name: string }).name).toBe("+199");
    expect((pipedrivePersonBody({}) as { name: string }).name).toBe("WhatsApp lead");
  });
});

describe("store helpers", () => {
  it("normalizeShop builds a myshopify host", () => {
    expect(normalizeShop("my-store")).toBe("my-store.myshopify.com");
    expect(normalizeShop("my-store.myshopify.com")).toBe("my-store.myshopify.com");
    expect(normalizeShop("https://my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShop("")).toBe("");
  });
  it("wooBase forces https and strips trailing slash", () => {
    expect(wooBase("shop.example.com")).toBe("https://shop.example.com");
    expect(wooBase("http://shop.example.com/")).toBe("https://shop.example.com");
    expect(wooBase("https://shop.example.com/")).toBe("https://shop.example.com");
  });
  it("toCents parses decimal prices", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("1500")).toBe(150000);
    expect(toCents("₹ 49.50")).toBe(4950);
    expect(toCents("")).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });
  it("mapShopifyProduct normalizes a product", () => {
    const p = mapShopifyProduct({ id: 12, title: "Tee", body_html: "<p>Soft <b>cotton</b></p>", status: "active", variants: [{ price: "9.99" }], image: { src: "https://x/y.jpg" } });
    expect(p).toMatchObject({ name: "Tee", description: "Soft cotton", priceCents: 999, imageUrl: "https://x/y.jpg", externalId: "12", available: true });
  });
  it("mapWooProduct normalizes a product and availability", () => {
    const p = mapWooProduct({ id: 7, name: "Mug", description: "<p>Ceramic</p>", price: "12.00", images: [{ src: "https://x/m.jpg" }], status: "draft" });
    expect(p).toMatchObject({ name: "Mug", description: "Ceramic", priceCents: 1200, imageUrl: "https://x/m.jpg", externalId: "7", available: false });
  });
});

describe("scheduling helpers", () => {
  it("parseCalcomSlots flattens, sorts, dedupes and caps", () => {
    const json = { slots: {
      "2026-06-21": [{ time: "2026-06-21T09:00:00Z" }, { time: "2026-06-21T09:00:00Z" }],
      "2026-06-20": [{ time: "2026-06-20T10:00:00Z" }, { time: "2026-06-20T11:00:00Z" }],
    } };
    const slots = parseCalcomSlots(json, "UTC");
    expect(slots).toHaveLength(3);                 // deduped
    expect(slots[0].iso).toBe("2026-06-20T10:00:00Z"); // sorted
    expect(slots[0].id).toBe("s0");
    expect(slots.every(s => s.label.length > 0)).toBe(true);
  });
  it("parseCalcomSlots tolerates empty / malformed input", () => {
    expect(parseCalcomSlots(null, "UTC")).toEqual([]);
    expect(parseCalcomSlots({ slots: {} }, "UTC")).toEqual([]);
  });
  it("matchSlot resolves an id or a 1-based position", () => {
    const ids = ["s0", "s1", "s2"];
    expect(matchSlot("s1", ids)).toBe("s1");
    expect(matchSlot("2", ids)).toBe("s1");
    expect(matchSlot("9", ids)).toBeNull();
    expect(matchSlot("nope", ids)).toBeNull();
  });
  it("extractEmail pulls a valid email or null", () => {
    expect(extractEmail("reach me at asha@example.com please")).toBe("asha@example.com");
    expect(extractEmail("no email here")).toBeNull();
  });
  it("formatSlotLabel renders in the given timezone", () => {
    const label = formatSlotLabel("2026-06-20T10:00:00Z", "UTC");
    expect(label).toMatch(/Sat/);
    expect(label).toMatch(/Jun/);
  });
});
