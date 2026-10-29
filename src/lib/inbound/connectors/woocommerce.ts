// WooCommerce: order confirmations and every order-status change on WhatsApp.
//
// Facts relied on (woocommerce.com/document/webhooks and the woocommerce
// source, checked 29 Oct 2026):
//   • X-WC-Webhook-Signature = base64 HMAC-SHA256 of the raw body, keyed with
//     the webhook's Secret — which the portal generates and the merchant pastes.
//   • Saving a webhook as Active sends a ping: the literal body
//     "webhook_id=<id>", with no signature and no X-WC headers. Anything but a
//     2xx makes the merchant's save FAIL, so it must be answered.
//   • order.updated fires on every change to an order, so the order's status is
//     part of the delivery id: a message per status, not per edit.
//   • After 5 failed deliveries in a row WooCommerce disables the webhook.

import { normalizePhone, firstText, formatMoney, tagsFrom, tidyName } from "../normalize";
import { hmac, safeEqual } from "../signature";
import { itemSummary } from "./shopify";
import type { Provider } from "../providers";

// Statuses worth a message; the rest (pending, draft, checkout-draft) are not.
const STATUSES = new Set(["processing", "on-hold", "completed", "cancelled", "refunded", "failed"]);

const isPing = (headers: Headers, body: Record<string, unknown>) =>
  !headers.get("x-wc-webhook-topic") && "webhook_id" in body && Object.keys(body).length === 1;

export const woocommerceProvider: Provider = {
  verify({ headers, raw, body, secrets }) {
    if (isPing(headers, body)) return null;   // the save-time ping carries no signature
    const secret = secrets.webhookSecret ?? "";
    if (!secret) return "No WooCommerce webhook secret is saved.";
    const sent = headers.get("x-wc-webhook-signature") ?? "";
    if (!sent) return "WooCommerce did not sign this request (no X-WC-Webhook-Signature).";
    return safeEqual(sent, hmac(secret, raw, "base64"))
      ? null
      : "WooCommerce's signature did not match. Paste the secret shown in the portal into the webhook's Secret field.";
  },

  parse({ headers, body, config }) {
    if (isPing(headers, body)) return [];
    const topic = headers.get("x-wc-webhook-topic") ?? "";
    if (topic !== "order.created" && topic !== "order.updated") return [];
    const status = firstText(body, ["status"]);
    const created = topic === "order.created";
    if (!created && !STATUSES.has(status)) return [];

    const currency = firstText(body, ["currency"]) || "INR";
    const total = formatMoney(firstText(body, ["total"]), currency);
    const name = tidyName([firstText(body, ["billing.first_name"]), firstText(body, ["billing.last_name"])].filter(Boolean).join(" "));
    const eventKey = created ? "woocommerce.order_created" : `woocommerce.order_${status.replace("-", "_")}`;
    return [{
      eventKey,
      externalId: `order:${firstText(body, ["id"])}:${created ? "created" : status}`,
      phone: normalizePhone(firstText(body, ["billing.phone", "shipping.phone"]), config.defaultCountryCode),
      name,
      email: firstText(body, ["billing.email"]),
      data: {
        order_number: firstText(body, ["number", "id"]),
        status: status.replace("-", " "),
        total, currency,
        items: itemSummary(body.line_items),
        payment_method: firstText(body, ["payment_method_title"]),
        payment_url: firstText(body, ["payment_url"]),
        store: headers.get("x-wc-webhook-source") ?? "",
      },
      tags: tagsFrom(config.tags, "WooCommerce customer"),
      attributes: { last_order: firstText(body, ["number", "id"]), last_order_total: total, last_order_status: status },
    }];
  },
};
