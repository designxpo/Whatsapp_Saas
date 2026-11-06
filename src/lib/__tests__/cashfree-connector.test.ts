// Cashfree: only signed deliveries are accepted (Base64 HMAC-SHA256 of the
// timestamp + raw body with the client secret, in either form Cashfree's docs
// show), and the documented payment events become receipts and nudges.
// Payload shapes follow Cashfree's published samples; values are synthetic.

import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { cashfreeProvider } from "../inbound/connectors/cashfree";
import { CATALOG } from "../inbound/catalog";
import { PROVIDERS } from "../inbound/providers";

const SECRET = "cf_test_client_secret";
const sign = (ts: string, raw: string, sep = "") => createHmac("sha256", SECRET).update(ts + sep + raw).digest("base64");
const ctx = (raw: string, headers: Record<string, string>, secrets: Record<string, string> = { clientSecret: SECRET }) =>
  ({ headers: new Headers(headers), raw, body: JSON.parse(raw), config: { defaultCountryCode: "91" }, secrets: { token: "t", ...secrets } }) as Parameters<typeof cashfreeProvider.verify>[0];

const success = {
  type: "PAYMENT_SUCCESS_WEBHOOK", event_time: "2026-11-06T11:30:00+05:30",
  data: {
    order: { order_id: "order_1042", order_amount: 1499, order_currency: "INR", order_tags: null },
    payment: { cf_payment_id: "1453995084705707520", payment_status: "SUCCESS", payment_amount: 1499, payment_group: "upi" },
    customer_details: { customer_name: "neha sharma", customer_id: "c1", customer_email: "neha@example.com", customer_phone: "9876500031" },
  },
};
const failed = { ...success, type: "PAYMENT_FAILED_WEBHOOK", data: { ...success.data, payment: { ...success.data.payment, cf_payment_id: "1504280029", payment_status: "FAILED" }, error_details: { error_description: "Payment declined by bank" } } };
const dropped = { ...success, type: "PAYMENT_USER_DROPPED_WEBHOOK", data: { ...success.data, payment: { ...success.data.payment, cf_payment_id: "975672265", payment_status: "USER_DROPPED" } } };

describe("Cashfree signatures", () => {
  const raw = JSON.stringify(success);
  it("accepts the signature computed either way Cashfree documents it", () => {
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-timestamp": "1762409400", "x-webhook-signature": sign("1762409400", raw) }))).toBeNull();
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-timestamp": "1762409400", "x-webhook-signature": sign("1762409400", raw, ".") }))).toBeNull();
  });
  it("refuses a wrong secret, a changed body, a changed timestamp, or a missing header", () => {
    const good = sign("1762409400", raw);
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-timestamp": "1762409400", "x-webhook-signature": good }, { clientSecret: "other" }))).toMatch(/did not match/);
    expect(cashfreeProvider.verify(ctx(raw.replace("1499", "1"), { "x-webhook-timestamp": "1762409400", "x-webhook-signature": good }))).toMatch(/did not match/);
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-timestamp": "1762409401", "x-webhook-signature": good }))).toMatch(/did not match/);
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-signature": good }))).toMatch(/did not sign/);
    expect(cashfreeProvider.verify(ctx(raw, { "x-webhook-timestamp": "1", "x-webhook-signature": good }, { clientSecret: "" }))).toMatch(/No Cashfree client secret/);
  });
});

describe("Cashfree events", () => {
  const parse = (b: unknown) => cashfreeProvider.parse(ctx(JSON.stringify(b), {}));
  it("turns a successful payment into a receipt event for the customer", () => {
    const [e] = parse(success);
    expect(e).toMatchObject({
      eventKey: "cashfree.payment_success", externalId: "PAYMENT_SUCCESS_WEBHOOK:1453995084705707520", phone: "919876500031", email: "neha@example.com",
      data: { order_id: "order_1042", payment_id: "1453995084705707520", status: "SUCCESS", method: "upi" },
      cancels: ["cashfree.payment_failed", "cashfree.payment_dropped"],
    });
    expect(e.data.amount).toMatch(/1,499/);
    expect(e.attributes!.last_payment).toMatch(/order_1042/);
  });
  it("turns failed and abandoned payments into nudges, and ignores other events", () => {
    expect(parse(failed)[0]).toMatchObject({ eventKey: "cashfree.payment_failed", data: { error: "Payment declined by bank" } });
    expect(parse(failed)[0].cancels).toBeUndefined();
    expect(parse(dropped)[0]).toMatchObject({ eventKey: "cashfree.payment_dropped", externalId: "PAYMENT_USER_DROPPED_WEBHOOK:975672265" });
    expect(parse({ type: "REFUND_STATUS_WEBHOOK", data: {} })).toEqual([]);
  });
  it("is listed as a working connection with every event it can send", () => {
    const entry = CATALOG.find(c => c.id === "cashfree")!;
    expect(entry.availability).toBe("available");
    expect(PROVIDERS.cashfree).toBe(cashfreeProvider);
    expect(entry.events!.map(e => e.key).sort()).toEqual(["cashfree.payment_dropped", "cashfree.payment_failed", "cashfree.payment_success"]);
    expect(entry.fields!.find(f => f.key === "clientSecret")).toMatchObject({ secret: true, required: true });
  });
});
