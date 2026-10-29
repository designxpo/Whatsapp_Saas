// Razorpay: payment receipts, failed-payment nudges, payment-link and
// subscription updates on WhatsApp.
//
// Facts this relies on (razorpay.com/docs/webhooks, checked 29 Oct 2026):
//   • X-Razorpay-Signature = hex HMAC-SHA256 of the RAW body, keyed with the
//     webhook secret the merchant typed (not the API key secret).
//   • x-razorpay-event-id identifies a delivery; delivery is at-least-once.
//   • 2xx within 5 s, or it retries for 24 h and then DISABLES the webhook —
//     which is why ingest is quick and a refusal is never a 5xx.
//   • Amounts are in paise. payment.contact is "+91…", but a payment link's
//     customer.contact can be bare digits; normalizePhone handles both.

import { normalizePhone, firstText, formatMoney, tagsFrom, tidyName, dig, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";
import type { NormalizedEvent } from "../ingest";

// Every call to the tool times out rather than holding the request open.
const extFetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

// Razorpay's event → ours. Anything else (order.paid duplicates
// payment.captured; the rest nobody messages about) is acknowledged and ignored.
const EVENTS: Record<string, string> = {
  "payment.captured": "razorpay.payment_captured",
  "payment.failed": "razorpay.payment_failed",
  "payment_link.paid": "razorpay.payment_link_paid",
  "refund.processed": "razorpay.refund_processed",
  "subscription.charged": "razorpay.subscription_charged",
  "subscription.halted": "razorpay.subscription_halted",
};

const rupees = (paise: unknown) => {
  const n = Number(paise);
  return Number.isFinite(n) ? n / 100 : NaN;
};

export const razorpayProvider: Provider = {
  verify({ headers, raw, secrets }) {
    const secret = secrets.webhookSecret ?? "";
    if (!secret) return "No webhook secret is saved for Razorpay.";
    const sent = headers.get("x-razorpay-signature") ?? "";
    if (!sent) return "Razorpay did not sign this request (no X-Razorpay-Signature).";
    return safeEqual(sent, hmac(secret, raw, "hex"))
      ? null
      : "Razorpay's signature did not match. Check the webhook secret in Razorpay is the one shown in the portal.";
  },

  parse({ headers, body, config }) {
    const eventKey = EVENTS[String(body.event ?? "")];
    if (!eventKey) return [];
    const p = (body.payload ?? {}) as Json;
    const payment = (dig(p, "payment.entity") ?? {}) as Json;
    const link = (dig(p, "payment_link.entity") ?? {}) as Json;
    const refund = (dig(p, "refund.entity") ?? {}) as Json;
    const notes = { ...((payment.notes as Json) ?? {}), ...((link.notes as Json) ?? {}) };

    const phone = normalizePhone(firstText(link, ["customer.contact"]) || firstText(payment, ["contact"]), config.defaultCountryCode);
    const name = tidyName(firstText(link, ["customer.name"]) || firstText(notes, ["name", "customer_name", "student_name"]));
    const email = firstText(link, ["customer.email"]) || firstText(payment, ["email"]);
    const currency = firstText(payment, ["currency"]) || firstText(link, ["currency"]) || "INR";
    const paise = eventKey === "razorpay.refund_processed" ? refund.amount
      : eventKey === "razorpay.payment_link_paid" ? (link.amount_paid ?? link.amount)
      : payment.amount;
    const amount = formatMoney(rupees(paise), currency);

    const data: Json = {
      amount, currency,
      amount_value: Number.isFinite(rupees(paise)) ? String(rupees(paise)) : "",
      payment_id: firstText(payment, ["id"]) || firstText(refund, ["payment_id"]),
      method: firstText(payment, ["method"]),
      description: firstText(payment, ["description"]) || firstText(link, ["description"]),
      order_id: firstText(payment, ["order_id"]),
      reference_id: firstText(link, ["reference_id"]),
      payment_link: firstText(link, ["short_url"]),
      refund_id: firstText(refund, ["id"]),
      error: firstText(payment, ["error_description", "error_reason"]),
      notes,
    };

    // Keyed on what happened (this payment, refund or link), which the
    // signature covers; the x-razorpay-event-id header is only the fallback.
    const entityId = firstText(refund, ["id"]) || firstText(link, ["id"]) || firstText(payment, ["id"]) || firstText(body, ["payload.subscription.entity.id"]);
    const event: NormalizedEvent = {
      eventKey,
      externalId: entityId ? `${eventKey}:${entityId}` : headers.get("x-razorpay-event-id") || null,
      phone, name, email, data,
      tags: tagsFrom(config.tags, "Razorpay customer"),
      attributes: {
        last_payment_amount: amount,
        last_payment_status: eventKey.replace("razorpay.", ""),
        ...(data.payment_id ? { last_payment_id: String(data.payment_id) } : {}),
      },
    };
    return [event];
  },

  // The API keys are optional — only payment links sent from the portal need
  // them — so connecting works on the webhook secret alone, and keys that ARE
  // given are checked rather than trusted.
  async connect({ secrets }) {
    if (!secrets.keyId || !secrets.keySecret) {
      return { ok: true, detail: "Connected. Add your API keys later if you want to send payment links from the portal." };
    }
    try {
      const r = await extFetch("https://api.razorpay.com/v1/payments?count=1", {
        headers: { Authorization: `Basic ${Buffer.from(`${secrets.keyId}:${secrets.keySecret}`).toString("base64")}` },
      });
      if (r.status === 401) return { ok: false, detail: "Razorpay rejected the API key id or secret. Copy both again from Razorpay → Account & Settings → API Keys." };
      if (!r.ok) return { ok: false, detail: `Razorpay answered HTTP ${r.status} when checking the API keys.` };
      return { ok: true, detail: `Connected. API keys work (${secrets.keyId.startsWith("rzp_test_") ? "test mode" : "live mode"}).` };
    } catch (err) {
      return { ok: false, detail: `Could not reach Razorpay: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
