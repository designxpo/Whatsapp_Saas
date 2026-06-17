import { describe, it, expect } from "vitest";
import {
  signPayload, humanText, buildWebhookRequest, isIntegrationEvent,
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
    expect(isIntegrationEvent("order.created")).toBe(true);
    expect(isIntegrationEvent("nope")).toBe(false);
  });
});
