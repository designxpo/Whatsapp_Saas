// Cashfree Payments: payment receipts and failed / abandoned payment nudges.
//
// Facts relied on (cashfree.com/docs, checked 6 Nov 2026):
//   • Headers x-webhook-signature and x-webhook-timestamp. The signature is the
//     Base64 HMAC-SHA256 of the timestamp joined to the RAW body, keyed with the
//     merchant's client secret (payments/online/webhooks/signature-verification).
//     That page shows the join both with no separator (its Node/Python samples)
//     and with a "." (its pseudocode), so both forms are accepted — each is an
//     HMAC under the business's own secret, so neither can be forged without it.
//   • Body {type, event_time, data}; type is PAYMENT_SUCCESS_WEBHOOK,
//     PAYMENT_FAILED_WEBHOOK or PAYMENT_USER_DROPPED_WEBHOOK, with
//     data.order.order_id / order_amount, data.payment.payment_status /
//     payment_amount / cf_payment_id, data.customer_details.customer_phone
//     (api-reference/payments/latest/payments/webhooks). Amounts are rupees,
//     not paise.

import { normalizePhone, firstText, formatMoney, tagsFrom, tidyName, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";

const EVENTS: Record<string, string> = {
  PAYMENT_SUCCESS_WEBHOOK: "cashfree.payment_success",
  PAYMENT_FAILED_WEBHOOK: "cashfree.payment_failed",
  PAYMENT_USER_DROPPED_WEBHOOK: "cashfree.payment_dropped",
};

export function cashfreeSignatures(secret: string, timestamp: string, raw: string): string[] {
  return [hmac(secret, timestamp + raw, "base64"), hmac(secret, `${timestamp}.${raw}`, "base64")];
}

export const cashfreeProvider: Provider = {
  verify({ headers, raw, secrets }) {
    const secret = secrets.clientSecret ?? "";
    if (!secret) return "No Cashfree client secret is saved.";
    const sent = headers.get("x-webhook-signature") ?? "";
    const ts = headers.get("x-webhook-timestamp") ?? "";
    if (!sent || !ts) return "Cashfree did not sign this request (no x-webhook-signature / x-webhook-timestamp).";
    return cashfreeSignatures(secret, ts, raw).some(s => safeEqual(sent, s))
      ? null
      : "Cashfree's signature did not match. Check the client secret saved here is the one for this Cashfree account (Test and Live have different secrets).";
  },

  parse({ body, config }) {
    const type = String(body.type ?? "");
    const eventKey = EVENTS[type];
    if (!eventKey) return [];
    const d = (body.data ?? {}) as Json;
    const currency = firstText(d, ["order.order_currency", "payment.payment_currency"]) || "INR";
    const paymentId = firstText(d, ["payment.cf_payment_id"]);
    const orderId = firstText(d, ["order.order_id"]);
    return [{
      eventKey,
      externalId: `${type}:${paymentId || orderId}`,
      phone: normalizePhone(firstText(d, ["customer_details.customer_phone"]), config.defaultCountryCode),
      name: tidyName(firstText(d, ["customer_details.customer_name"])),
      email: firstText(d, ["customer_details.customer_email"]),
      data: {
        amount: formatMoney(firstText(d, ["payment.payment_amount", "order.order_amount"]), currency),
        order_id: orderId,
        payment_id: paymentId,
        status: firstText(d, ["payment.payment_status"]),
        method: firstText(d, ["payment.payment_group"]),
        error: firstText(d, ["error_details.error_description", "payment.payment_message"]),
      },
      tags: tagsFrom(config.tags, "Cashfree customer"),
      attributes: (eventKey === "cashfree.payment_success" ? { last_payment: `${formatMoney(firstText(d, ["payment.payment_amount"]), currency)} — ${orderId}`.slice(0, 120) } : {}) as Record<string, string>,
      // A later success means the earlier failure/abandon nudges no longer apply.
      ...(eventKey === "cashfree.payment_success" ? { cancels: ["cashfree.payment_failed", "cashfree.payment_dropped"] } : {}),
    }];
  },
};
