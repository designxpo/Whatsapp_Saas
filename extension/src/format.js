// Pure formatting for the context card and the cart. Money is the thing a tenant
// will notice instantly if it's wrong, so it lives here and is unit-tested.

const SYMBOLS = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", AUD: "A$", CAD: "C$" };

/**
 * Minor units → a readable amount. Whole amounts drop the decimals (₹1,299, not
 * ₹1,299.00) because catalogs are overwhelmingly round numbers; anything with
 * paise keeps them so a real 1,299.50 is never shown as 1,299.
 * @param {number} cents
 * @param {string} [currency]
 */
export function money(cents, currency = "INR") {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  const sym = SYMBOLS[String(currency).toUpperCase()] ?? `${currency} `;
  const amount = n / 100;
  const whole = Number.isInteger(amount);
  // en-IN groups as 1,29,900 — the grouping Indian tenants expect.
  const locale = String(currency).toUpperCase() === "INR" ? "en-IN" : "en-US";
  return sym + amount.toLocaleString(locale, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Cart/line total in minor units. */
export function cartTotal(items = []) {
  return items.reduce((sum, i) => sum + (Number(i.priceCents) || 0) * (Number(i.qty) || 0), 0);
}

/** "2 items · ₹2,598" — the one-line cart summary. */
export function cartSummary(items = [], currency = "INR") {
  const count = items.reduce((n, i) => n + (Number(i.qty) || 0), 0);
  if (!count) return "Cart is empty";
  return `${count} item${count === 1 ? "" : "s"} · ${money(cartTotal(items), currency)}`;
}

/**
 * The customer-facing message for a product, ready to edit before sending.
 * Only includes a link when the catalog actually has one.
 */
export function productMessage(p) {
  const price = money(p?.priceCents, p?.currency);
  const lines = [`${p?.name ?? "This item"} — ${price}`];
  if (p?.description) lines.push(String(p.description).slice(0, 200));
  if (p?.buttonUrl) lines.push(p.buttonUrl);
  return lines.join("\n");
}

/** The message that carries a payment link. */
export function payMessage(totalCents, paymentUrl, currency = "INR") {
  return `Here's your payment link for ${money(totalCents, currency)}:\n${paymentUrl}`;
}

/** "3 orders · ₹6,297 lifetime" / "No orders yet" for the context card. */
export function ordersSummary(orders) {
  if (!orders || !orders.count) return "No orders yet";
  const parts = [`${orders.count} order${orders.count === 1 ? "" : "s"}`];
  if (orders.lifetimeCents > 0) parts.push(`${money(orders.lifetimeCents, orders.currency)} lifetime`);
  return parts.join(" · ");
}
