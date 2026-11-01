// The auto-renewal disclosure a customer agrees to before paying. Pure text, no
// I/O — the billing page renders it next to the pay button and the checkout
// routes record the same words, so what was shown and what was stored can't
// drift apart.
//
// Why this exists: a subscription that renews on its own needs the renewal,
// the exact amount and how to stop it stated where the customer decides, and
// an explicit "yes" to it — not a "/month" suffix on a price card. The
// checkbox starts unticked and the checkout routes refuse to start without it.

/** "every month", "every year", "every 3 months". */
export function everyText(interval: string, count = 1): string {
  const unit = (interval || "month").toLowerCase().replace(/ly$/, "").replace(/^dai$/, "day");
  return count > 1 ? `every ${count} ${unit}s` : `every ${unit}`;
}

/** The ack label for a given billing interval — monthly is the common case. */
export function autoRenewAckLabel(interval = "month", count = 1): string {
  return `I understand this renews automatically ${everyText(interval, count)} until I cancel`;
}

/** The sentence shown next to the pay button. `amount` is pre-formatted (₹2,047). */
export function autoRenewStatement(amount: string, interval = "month", count = 1): string {
  return `Renews automatically ${everyText(interval, count)} at ${amount} until you cancel. Cancel anytime from this page.`;
}

/**
 * Checkout bodies must carry `autoRenewAck: true`. Anything else — missing,
 * "true" as a string, 1 — is treated as not agreed: consent is a deliberate
 * tick, and a loose check would let an old tab or a script skip it.
 */
export function hasAutoRenewAck(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { autoRenewAck?: unknown }).autoRenewAck === true;
}

export const AUTO_RENEW_ACK_REQUIRED = "Please confirm you understand the plan renews automatically until you cancel.";

/** The audit-row text recording what was agreed to, and when. */
export function autoRenewAckDetail(p: { planKey: string; provider: string; amountCents: number; currency: string; interval: string; intervalCount?: number; at?: Date }): string {
  const at = (p.at ?? new Date()).toISOString();
  return `plan=${p.planKey} provider=${p.provider} amount=${p.amountCents} ${p.currency} ${everyText(p.interval, p.intervalCount ?? 1)} at=${at} — "${autoRenewAckLabel(p.interval, p.intervalCount ?? 1)}"`;
}
