// Each connector: is a delivery really from the tool, and what does it mean?
//
// Signatures are computed here the way each tool's docs say it computes them,
// so a connector that verifies the wrong thing (parsed JSON instead of the raw
// body, hex instead of base64, the wrong header) fails a test rather than
// refusing every real delivery. Payloads are synthetic.
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { normalizePhone, findPerson, parseBody, formatMoney, formatWhen } from "../inbound/normalize";
import { PROVIDERS, type InboundContext } from "../inbound/providers";

const sign = (secret: string, msg: string, enc: "hex" | "base64") => createHmac("sha256", secret).update(msg).digest(enc);
function ctx(raw: string, headers: Record<string, string>, secrets: Record<string, string> = {}, config: Record<string, string> = {}): InboundContext {
  return { headers: new Headers(headers), raw, body: parseBody(raw, headers["content-type"] ?? "application/json") ?? {}, config, secrets: { token: "t", ...secrets } };
}

describe("phone numbers from any tool", () => {
  it("become WhatsApp digits with a country code", () => {
    expect(normalizePhone("+91 98765 00001")).toBe("919876500001");
    expect(normalizePhone("098765 00001")).toBe("919876500001");
    expect(normalizePhone("9876500001")).toBe("919876500001");
    expect(normalizePhone("+91-9876500001")).toBe("919876500001");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(normalizePhone("4155550100", "1")).toBe("14155550100");
  });

  it("are refused when they cannot be a WhatsApp mobile", () => {
    for (const bad of ["", null, "12345", "011 2345 6789", "abc", "+91 5876500001"]) expect(normalizePhone(bad)).toBe("");
  });
});

describe("shared helpers", () => {
  it("finds the person in a generic payload, by usual keys or an explicit path", () => {
    expect(findPerson({ Mobile: "9876500001", first_name: "ASHA", last_name: "VERMA" })).toEqual({ phone: "919876500001", name: "Asha Verma", email: "" });
    expect(findPerson({ lead: { mobile: "9876500002" } }, { phonePath: "lead.mobile" }).phone).toBe("919876500002");
  });

  it("reads JSON and form-encoded bodies", () => {
    expect(parseBody('{"a":1}', "application/json")).toEqual({ a: 1 });
    expect(parseBody("webhook_id=12", "application/x-www-form-urlencoded")).toEqual({ webhook_id: "12" });
    expect(parseBody("{not json", "application/json")).toBeNull();
  });

  it("formats money the Indian way and times in the customer's zone", () => {
    expect(formatMoney(1908000 / 100)).toBe("₹19,080");
    expect(formatMoney("1234567.5")).toBe("₹12,34,567.50");
    expect(formatMoney(25, "USD")).toBe("USD 25");
    expect(formatWhen("2026-10-30T11:00:00Z", "Asia/Kolkata").time).toMatch(/4:30\s?pm/i);
  });
});

describe("Shopify", () => {
  const order = JSON.stringify({
    id: 5501, name: "#1042", order_number: 1042, total_price: "2499.00", currency: "INR", email: "a@example.com",
    customer: { first_name: "Asha", last_name: "Verma", phone: null },
    billing_address: { phone: "+91 98765 00001" }, line_items: [{ title: "Blue Kurta" }, { title: "Silk Dupatta" }, { title: "Bangles" }],
    order_status_url: "https://shop.example/status", payment_gateway_names: ["Cash on Delivery (COD)"],
  });
  const headers = (raw: string, topic: string) => ({ "x-shopify-topic": topic, "x-shopify-webhook-id": "wh-1", "x-shopify-shop-domain": "demo.myshopify.com", "x-shopify-hmac-sha256": sign("shpkey", raw, "base64") });

  it("accepts its own signature over the raw body, and nothing else", () => {
    expect(PROVIDERS.shopify.verify(ctx(order, headers(order, "orders/create"), { signingKey: "shpkey" }))).toBeNull();
    expect(PROVIDERS.shopify.verify(ctx(order, { ...headers(order, "orders/create"), "x-shopify-hmac-sha256": sign("other", order, "base64") }, { signingKey: "shpkey" }))).toMatch(/did not match/);
    expect(PROVIDERS.shopify.verify(ctx(order, { "x-shopify-topic": "orders/create" }, { signingKey: "shpkey" }))).toMatch(/did not sign/);
  });

  it("refuses every delivery until the signing key is saved, and says so", () => {
    expect(PROVIDERS.shopify.verify(ctx(order, headers(order, "orders/create"), {}))).toMatch(/No Shopify webhook signing key/);
  });

  it("refuses a delivery from a different store when the domain is set", () => {
    expect(PROVIDERS.shopify.verify(ctx(order, headers(order, "orders/create"), { signingKey: "shpkey" }, { shopDomain: "mine.myshopify.com" }))).toMatch(/not mine\.myshopify\.com/);
  });

  it("turns an order into a confirmation event that cancels the abandoned-cart reminder", () => {
    const [e] = PROVIDERS.shopify.parse(ctx(order, headers(order, "orders/create")));
    expect(e).toMatchObject({
      eventKey: "shopify.order_created", externalId: "orders/create:5501", phone: "919876500001", name: "Asha Verma",
      cancels: ["shopify.checkout_started"],
      data: { order_name: "#1042", total: "₹2,499", items: "Blue Kurta, Silk Dupatta and 1 more", cash_on_delivery: "yes" },
    });
  });

  it("treats the same order as one event even when a store added the webhook twice", () => {
    const first = PROVIDERS.shopify.parse(ctx(order, headers(order, "orders/create")))[0];
    const again = PROVIDERS.shopify.parse(ctx(order, { ...headers(order, "orders/create"), "x-shopify-webhook-id": "wh-2" }))[0];
    expect(again.externalId).toBe(first.externalId);
  });

  it("sends one shipping update per status, and one reminder per checkout", () => {
    const f = JSON.stringify({ id: 77, shipment_status: "out_for_delivery", tracking_url: "https://t.example/1", destination: { phone: "9876500001" } });
    const [s] = PROVIDERS.shopify.parse(ctx(f, headers(f, "fulfillments/update")));
    expect(s).toMatchObject({ eventKey: "shopify.shipment_update", externalId: "fulfillment:77:out_for_delivery", data: { shipment_status: "out for delivery" } });
    const c = JSON.stringify({ token: "ck1", phone: "9876500001", abandoned_checkout_url: "https://shop.example/recover", total_price: "999" });
    const [ck] = PROVIDERS.shopify.parse(ctx(c, headers(c, "checkouts/update")));
    expect(ck).toMatchObject({ eventKey: "shopify.checkout_started", externalId: "checkout:ck1", data: { recovery_url: "https://shop.example/recover" } });
  });

  it("ignores topics nobody messages about", () => {
    expect(PROVIDERS.shopify.parse(ctx("{}", headers("{}", "products/update")))).toEqual([]);
  });
});

describe("WooCommerce", () => {
  const raw = JSON.stringify({ id: 9, number: "1042", status: "processing", total: "2499.00", currency: "INR", billing: { first_name: "asha", last_name: "verma", phone: "09876500001", email: "a@example.com" }, line_items: [{ name: "Blue Kurta" }] });
  const signed = (topic: string, body = raw) => ({ "x-wc-webhook-topic": topic, "x-wc-webhook-signature": sign("wcsecret", body, "base64") });

  it("answers the unsigned save-time ping, and refuses any other unsigned delivery", () => {
    const ping = ctx("webhook_id=12", { "content-type": "application/x-www-form-urlencoded" }, { webhookSecret: "wcsecret" });
    expect(PROVIDERS.woocommerce.verify(ping)).toBeNull();
    expect(PROVIDERS.woocommerce.parse(ping)).toEqual([]);
    expect(PROVIDERS.woocommerce.verify(ctx(raw, { "x-wc-webhook-topic": "order.updated" }, { webhookSecret: "wcsecret" }))).toMatch(/did not sign/);
  });

  it("messages once per order status, not once per edit", () => {
    const c = ctx(raw, signed("order.updated"), { webhookSecret: "wcsecret" });
    expect(PROVIDERS.woocommerce.verify(c)).toBeNull();
    expect(PROVIDERS.woocommerce.parse(c)[0]).toMatchObject({ eventKey: "woocommerce.order_processing", externalId: "order:9:processing", phone: "919876500001", name: "Asha Verma" });
    const pending = JSON.stringify({ id: 9, status: "pending", billing: { phone: "9876500001" } });
    expect(PROVIDERS.woocommerce.parse(ctx(pending, signed("order.updated", pending)))).toEqual([]);
  });
});

describe("Razorpay", () => {
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", amount: 1908000, currency: "INR", contact: "+919876500001", email: "a@example.com", method: "upi", notes: { name: "Asha Verma" } } } } });

  it("verifies the hex signature of the raw body", () => {
    expect(PROVIDERS.razorpay.verify(ctx(raw, { "x-razorpay-signature": sign("rzpsecret", raw, "hex") }, { webhookSecret: "rzpsecret" }))).toBeNull();
    expect(PROVIDERS.razorpay.verify(ctx(raw, { "x-razorpay-signature": sign("rzpsecret", raw + " ", "hex") }, { webhookSecret: "rzpsecret" }))).toMatch(/did not match/);
  });

  it("turns paise into rupees and dedupes on the payment itself", () => {
    const [e] = PROVIDERS.razorpay.parse(ctx(raw, { "x-razorpay-event-id": "evt_1" }));
    expect(e).toMatchObject({ eventKey: "razorpay.payment_captured", externalId: "razorpay.payment_captured:pay_1", phone: "919876500001", name: "Asha Verma", data: { amount: "₹19,080", payment_id: "pay_1" } });
    // A replay under a fresh event-id header (not covered by the signature) is still the same payment.
    expect(PROVIDERS.razorpay.parse(ctx(raw, { "x-razorpay-event-id": "evt_forged" }))[0].externalId).toBe("razorpay.payment_captured:pay_1");
  });

  it("reads a payment link's bare-digit customer number", () => {
    const link = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { amount_paid: 50000, currency: "INR", reference_id: "INST-2", short_url: "https://rzp.io/x", customer: { name: "Asha", contact: "9876500001" } } }, payment: { entity: { id: "pay_2" } } } });
    expect(PROVIDERS.razorpay.parse(ctx(link, {}))[0]).toMatchObject({ eventKey: "razorpay.payment_link_paid", phone: "919876500001", data: { amount: "₹500", reference_id: "INST-2" } });
  });

  it("ignores events nobody messages about", () => {
    expect(PROVIDERS.razorpay.parse(ctx(JSON.stringify({ event: "order.paid", payload: {} }), {}))).toEqual([]);
  });
});

describe("Calendly", () => {
  const body = (event: string, payload: object) => JSON.stringify({ event, payload });
  const signed = (raw: string, t = Math.floor(Date.now() / 1000)) => ({ "calendly-webhook-signature": `t=${t},v1=${sign("calkey", `${t}.${raw}`, "hex")}` });
  const booking = { uri: "https://api.calendly.com/inv/1", name: "Asha Verma", email: "a@example.com", timezone: "Asia/Kolkata", questions_and_answers: [{ question: "WhatsApp number", answer: "98765 00001" }], scheduled_event: { name: "Counselling", start_time: "2026-10-30T11:00:00Z", location: { join_url: "https://meet.example/x" } } };

  it("verifies t.body with the signing key and refuses a stale signature", () => {
    const raw = body("invitee.created", booking);
    expect(PROVIDERS.calendly.verify(ctx(raw, signed(raw), { signingKey: "calkey" }))).toBeNull();
    expect(PROVIDERS.calendly.verify(ctx(raw, signed(raw, Math.floor(Date.now() / 1000) - 600), { signingKey: "calkey" }))).toMatch(/too old/);
  });

  it("finds the phone among the answers and says when, in the invitee's zone", () => {
    const [e] = PROVIDERS.calendly.parse(ctx(body("invitee.created", booking), {}));
    expect(e).toMatchObject({ eventKey: "calendly.booking_created", phone: "919876500001", data: { meeting: "Counselling", join_url: "https://meet.example/x" } });
    expect(String(e.data.when)).toMatch(/Fri, 30 Oct, 4:30\s?pm/i);
  });

  it("reads a reschedule as one rescheduled event, and a real cancel as a cancel", () => {
    expect(PROVIDERS.calendly.parse(ctx(body("invitee.canceled", { ...booking, rescheduled: true }), {}))).toEqual([]);
    expect(PROVIDERS.calendly.parse(ctx(body("invitee.created", { ...booking, old_invitee: "x" }), {}))[0].eventKey).toBe("calendly.booking_rescheduled");
    expect(PROVIDERS.calendly.parse(ctx(body("invitee.canceled", booking), {}))[0]).toMatchObject({ eventKey: "calendly.booking_canceled", cancels: ["calendly.booking_created", "calendly.booking_rescheduled"] });
  });
});

describe("Cal.com", () => {
  const raw = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: "u1", title: "Demo call", startTime: "2026-10-30T11:00:00Z", attendees: [{ name: "Asha Verma", email: "a@example.com", timeZone: "Asia/Kolkata" }], responses: { attendeePhoneNumber: { value: "+919876500001" } }, metadata: { videoCallUrl: "https://cal.com/video/x" } } });

  it("verifies the hex signature and explains a missing secret", () => {
    expect(PROVIDERS.calcom.verify(ctx(raw, { "x-cal-signature-256": sign("calsecret", raw, "hex") }, { webhookSecret: "calsecret" }))).toBeNull();
    expect(PROVIDERS.calcom.verify(ctx(raw, { "x-cal-signature-256": "no-secret-provided" }, { webhookSecret: "calsecret" }))).toMatch(/without a secret/);
  });

  it("reads the attendee's phone from the booking form", () => {
    expect(PROVIDERS.calcom.parse(ctx(raw, {}))[0]).toMatchObject({ eventKey: "calcom.booking_created", phone: "919876500001", name: "Asha Verma", data: { meeting_url: "https://cal.com/video/x" } });
  });
});

describe("Typeform", () => {
  const raw = JSON.stringify({ event_type: "form_response", form_response: { token: "tok1", form_id: "F1", definition: { title: "Course enquiry", fields: [{ id: "n", title: "Your name" }, { id: "c", title: "Which course?" }] }, answers: [
    { type: "text", text: "asha verma", field: { id: "n", type: "short_text" } },
    { type: "phone_number", phone_number: "+919876500001", field: { id: "p", type: "phone_number" } },
    { type: "choice", choice: { label: "Data Science" }, field: { id: "c", type: "multiple_choice", ref: "course" } },
  ] } });

  it("verifies sha256=<base64> and maps answers by their ref", () => {
    expect(PROVIDERS.typeform.verify(ctx(raw, { "typeform-signature": `sha256=${sign("tfsecret", raw, "base64")}` }, { webhookSecret: "tfsecret" }))).toBeNull();
    expect(PROVIDERS.typeform.parse(ctx(raw, {}))[0]).toMatchObject({ eventKey: "typeform.form_submitted", externalId: "tok1", phone: "919876500001", name: "Asha Verma", data: { course: "Data Science", form: "Course enquiry" } });
  });
});

describe("IndiaMART", () => {
  it("greets the buyer, and drops the placeholder name IndiaMART uses", () => {
    const raw = JSON.stringify({ CODE: 200, RESPONSE: { UNIQUE_QUERY_ID: "q1", QUERY_TYPE: "W", SENDER_NAME: "IndiaMART Buyer", SENDER_MOBILE: "+91-9876500001", QUERY_PRODUCT_NAME: "Industrial Mixer", SENDER_CITY: "Pune" } });
    expect(PROVIDERS.indiamart.parse(ctx(raw, {}))[0]).toMatchObject({ eventKey: "indiamart.lead_received", externalId: "q1", phone: "919876500001", name: "", data: { product: "Industrial Mixer", city: "Pune", enquiry_type: "Direct enquiry" } });
  });
});

describe("Webhooks (any app)", () => {
  it("makes one event per item, keyed by the payload's own event name", () => {
    const raw = JSON.stringify({ items: [{ event: "Signup Done", phone: "9876500001", name: "Asha" }, { phone: "9876500002" }] });
    const events = PROVIDERS.webhook.parse(ctx(raw, {}, {}, { eventName: "lead" }));
    expect(events.map(e => [e.eventKey, e.phone])).toEqual([["webhook.signup_done", "919876500001"], ["webhook.lead", "919876500002"]]);
  });

  it("never copies credentials or the person's own details into contact attributes", () => {
    const [e] = PROVIDERS.webhook.parse(ctx(JSON.stringify({ phone: "9876500001", course: "Data Science", password: "x", api_token: "y", email: "a@example.com", lsq_lead_id: "forged" }), {}));
    expect(e.attributes).toMatchObject({ webhook_course: "Data Science" });
    const keys = Object.keys(e.attributes ?? {});
    for (const k of ["password", "api_token", "phone", "email", "webhook_password", "webhook_api_token"]) expect(keys).not.toContain(k);
    // A payload cannot overwrite an attribute the rest of the portal depends on.
    expect(keys).not.toContain("lsq_lead_id");
    expect(e.attributes).toMatchObject({ webhook_lsq_lead_id: "forged" });
  });
});
