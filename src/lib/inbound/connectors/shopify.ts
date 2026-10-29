// Shopify: order confirmations, payment and cancellation notices, shipping
// updates with tracking, and abandoned-checkout recovery on WhatsApp.
//
// Connected through webhooks the merchant creates in their own admin
// (Settings → Notifications → Webhooks), not an app: new custom apps can no
// longer be made in the Shopify admin since 1 Jan 2026, and admin webhooks
// need nothing but a URL. Facts relied on (shopify.dev webhooks docs and
// help.shopify.com, checked 29 Oct 2026):
//   • X-Shopify-Hmac-Sha256 = base64 HMAC-SHA256 of the raw body, keyed with
//     the store's webhook signing key (shown under the store's webhook list).
//   • X-Shopify-Topic names the event; X-Shopify-Webhook-Id identifies the
//     delivery; X-Shopify-Shop-Domain is the myshopify.com domain.
//   • Order phone is often null at the top level and on the customer — the
//     billing or shipping address usually has it.

import { normalizePhone, firstText, formatMoney, tagsFrom, tidyName, type Json } from "../normalize";
import { hmac, safeEqual } from "../signature";
import type { Provider } from "../providers";
import type { NormalizedEvent } from "../ingest";

const ORDER_TOPICS: Record<string, string> = {
  "orders/create": "shopify.order_created",
  "orders/paid": "shopify.order_paid",
  "orders/fulfilled": "shopify.order_fulfilled",
  "orders/cancelled": "shopify.order_cancelled",
};

/** "Blue Kurta, Silk Dupatta and 2 more". */
export function itemSummary(items: unknown): string {
  const names = (Array.isArray(items) ? items : [])
    .map(i => firstText(i, ["title", "name"])).filter(Boolean);
  if (!names.length) return "";
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function person(o: Json, config: Record<string, string>) {
  const phone = normalizePhone(
    firstText(o, ["phone", "customer.phone", "billing_address.phone", "shipping_address.phone", "destination.phone"]),
    config.defaultCountryCode,
  );
  const first = firstText(o, ["customer.first_name", "billing_address.first_name", "shipping_address.first_name", "destination.first_name"]);
  const last = firstText(o, ["customer.last_name", "billing_address.last_name", "shipping_address.last_name", "destination.last_name"]);
  return {
    phone,
    name: tidyName([first, last].filter(Boolean).join(" ") || firstText(o, ["billing_address.name", "shipping_address.name"])),
    email: firstText(o, ["email", "customer.email", "contact_email"]),
  };
}

export const shopifyProvider: Provider = {
  verify({ headers, raw, secrets, config }) {
    const key = secrets.signingKey ?? "";
    if (!key) return "No Shopify webhook signing key is saved.";
    const sent = headers.get("x-shopify-hmac-sha256") ?? "";
    if (!sent) return "Shopify did not sign this request (no X-Shopify-Hmac-Sha256).";
    if (!safeEqual(sent, hmac(key, raw, "base64"))) {
      return "Shopify's signature did not match. Copy the signing key again from Settings → Notifications → Webhooks.";
    }
    const shop = (headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
    const want = (config.shopDomain ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (want && shop && shop !== want) return `This came from ${shop}, not ${want}.`;
    return null;
  },

  parse({ headers, body, config }) {
    const topic = headers.get("x-shopify-topic") ?? "";
    const deliveryId = headers.get("x-shopify-webhook-id");
    const tags = tagsFrom(config.tags, "Shopify customer");

    if (ORDER_TOPICS[topic]) {
      const eventKey = ORDER_TOPICS[topic];
      const p = person(body, config);
      const currency = firstText(body, ["currency"]) || "INR";
      const total = formatMoney(firstText(body, ["total_price"]), currency);
      const fulfillment = (Array.isArray(body.fulfillments) ? body.fulfillments[0] : null) as Json | null;
      const gateway = firstText(body, ["payment_gateway_names.0", "gateway"]);
      const data: Json = {
        order_name: firstText(body, ["name"]),
        order_number: firstText(body, ["order_number"]),
        total, currency,
        items: itemSummary(body.line_items),
        status_url: firstText(body, ["order_status_url"]),
        payment_method: gateway,
        cash_on_delivery: /cash on delivery|\bcod\b/i.test(gateway) ? "yes" : "no",
        financial_status: firstText(body, ["financial_status"]),
        cancel_reason: firstText(body, ["cancel_reason"]),
        tracking_number: fulfillment ? firstText(fulfillment, ["tracking_number"]) : "",
        tracking_url: fulfillment ? firstText(fulfillment, ["tracking_url"]) : "",
        courier: fulfillment ? firstText(fulfillment, ["tracking_company"]) : "",
        shop: headers.get("x-shopify-shop-domain") ?? "",
      };
      // Keyed on the ORDER, not the delivery: a store that added the same
      // webhook twice sends each order twice with two delivery ids, and the
      // order id — unlike the delivery-id header — is covered by the signature.
      const orderId = firstText(body, ["id"]);
      const event: NormalizedEvent = {
        eventKey, externalId: orderId ? `${topic}:${orderId}` : deliveryId, ...p, data, tags,
        attributes: { last_order: String(data.order_name), last_order_total: total, last_order_status: eventKey.replace("shopify.", "") },
        // They ordered: the abandoned-checkout reminder no longer applies.
        ...(eventKey === "shopify.order_created" ? { cancels: ["shopify.checkout_started"] } : {}),
      };
      return [event];
    }

    if (topic === "fulfillments/create" || topic === "fulfillments/update") {
      // One message per shipment status — "update" arrives for every change,
      // so the status is part of the id a retry is matched on.
      const status = firstText(body, ["shipment_status"]) || (topic === "fulfillments/create" ? "shipped" : "");
      if (!status) return [];
      const p = person(body, config);
      return [{
        eventKey: "shopify.shipment_update",
        externalId: `fulfillment:${firstText(body, ["id"])}:${status}`,
        ...p, tags,
        data: {
          shipment_status: status.replace(/_/g, " "),
          order_name: firstText(body, ["name"]),
          tracking_number: firstText(body, ["tracking_number", "tracking_numbers.0"]),
          tracking_url: firstText(body, ["tracking_url", "tracking_urls.0"]),
          courier: firstText(body, ["tracking_company"]),
        },
      }];
    }

    if (topic === "checkouts/create" || topic === "checkouts/update") {
      // One reminder per checkout: its token is the id. An order placed
      // afterwards cancels it (see order_created above).
      const p = person(body, config);
      const currency = firstText(body, ["currency", "presentment_currency"]) || "INR";
      return [{
        eventKey: "shopify.checkout_started",
        externalId: `checkout:${firstText(body, ["token", "id"])}`,
        ...p, tags,
        data: {
          recovery_url: firstText(body, ["abandoned_checkout_url"]),
          total: formatMoney(firstText(body, ["total_price"]), currency),
          items: itemSummary(body.line_items),
          accepts_marketing: body.buyer_accepts_marketing === true ? "yes" : "no",
        },
      }];
    }
    return [];
  },
};
