// Dunning — the two emails a tenant gets when their subscription payment stops
// working: one the moment a charge is declined (still fixable in place), and one
// when Stripe gives up and the workspace is paused. Without them a failed
// payment is invisible until the owner next opens the portal and finds the red
// banner — and invisible full stop while enforce_entitlements is off, which is
// the default, because that banner never renders.
//
// Both are transactional billing notices about an account the recipient owns, so
// there's no unsubscribe link.
//
// Idempotency: Stripe redelivers webhooks, and the point of dunning is to speak
// up once PER failed attempt. So every send sits behind an atomic
// claimWebhookEvent() keyed to the exact attempt — a redelivery of the same
// attempt is dropped, a genuinely new retry gets its own email. The claim is
// taken BEFORE the send and never released: a transient Resend failure loses one
// notice rather than risking a double-send, and Stripe's next retry (days later,
// a new attempt number) self-heals it.

import { claimWebhookEvent } from "./store";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";
import type { Tenant } from "./tenants";

// Plain fields rather than a Stripe.Invoice: this module stays unit-testable
// without the Stripe SDK, and the webhook keeps the type narrowing.
export interface FailedPayment {
  invoiceId: string;
  /** invoice.attempt_count — 1 on the first decline, then one per smart retry. */
  attempt: number;
  amountCents: number;
  /** Lowercase, as Stripe sends it. */
  currency: string;
  /** null when Stripe won't retry on its own — the tenant has to act. */
  nextAttemptISO: string | null;
  /** Stripe's hosted invoice page — pays the invoice without signing in. */
  invoiceUrl: string | null;
}

// Same formatter as the billing page.
function money(cents: number, currency: string): string {
  const cur = currency.toUpperCase();
  return `${cur === "INR" ? "₹" : `${cur} `}${(cents / 100).toLocaleString()}`;
}

// "3 Aug 2026" — the same date shape the weekly recap uses.
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Where every dunning email points. /admin/billing 404s on the marketing host
// (middleware's host split), so route through /login — that redirects to the app
// host and the login page lands on billing afterwards.
const FIX_BILLING = "/login?next=/admin/billing";

/**
 * A charge was declined and the tenant is now past_due. One email per failed
 * attempt. Returns true only when an email actually went out.
 */
export async function notifyPaymentFailed(tenant: Tenant, inv: FailedPayment): Promise<boolean> {
  if (!tenant.ownerEmail) return false;
  // One email per (invoice, attempt): a redelivery of the same attempt is
  // dropped, the next smart retry claims its own key and sends its own notice.
  if (!(await claimWebhookEvent(`dunning:failed:${inv.invoiceId}:${inv.attempt}`))) return false;

  const declined = inv.amountCents > 0
    ? `Your bank declined the ${money(inv.amountCents, inv.currency)} charge for your Talko AI subscription.`
    : "Your bank declined the latest charge for your Talko AI subscription.";
  const retry = inv.nextAttemptISO
    ? `We'll try the same card again on ${day(inv.nextAttemptISO)}. Updating it before then is usually all it takes.`
    : "We won't retry this one automatically, so it needs a payment from your billing page to clear.";

  const { html, text } = renderEmail({
    preheader: "Nothing has switched off — the card just needs updating.",
    heading: "Your last payment didn't go through",
    paragraphs: [
      `${declined} That's usually something ordinary — an expired card, a spending limit, or a bank verification prompt nobody saw.`,
      retry,
    ],
    highlight: "Your inbox and AI replies keep running in the meantime. Broadcast campaigns are paused while the account is past due, and switch back on the moment a payment succeeds.",
    cta: { label: "Update your card", href: FIX_BILLING },
    ...(inv.invoiceUrl ? { secondary: { label: "Pay this invoice now", href: inv.invoiceUrl } } : {}),
    footerReason: "You're getting this because you own a Talko AI workspace and a payment on it was declined. It's sent once per failed attempt — there's nothing recurring here to unsubscribe from.",
  }, SITE_URL);

  const result = await sendEmail({ to: tenant.ownerEmail, subject: "Your Talko AI payment didn't go through", html, text });
  if (!result.ok) console.error("[dunning] payment-failed send failed", tenant.id, result.error);
  return result.ok;
}

/**
 * Stripe has stopped retrying (subscription → unpaid) and the workspace is now
 * suspended. One email per suspension. Returns true only when one went out.
 */
export async function notifyServiceSuspended(tenant: Tenant, subscriptionId: string): Promise<boolean> {
  if (!tenant.ownerEmail) return false;
  // Suspension is one transition, not a repeating attempt — a single key per
  // subscription. The dedup prune is what lets a later, genuinely new lapse
  // send again.
  if (!(await claimWebhookEvent(`dunning:suspended:${subscriptionId}`))) return false;

  const { html, text } = renderEmail({
    preheader: "Nothing has been deleted — one payment brings it all back.",
    heading: "Your workspace is paused",
    paragraphs: [
      "We tried your card several times over the past couple of weeks and none of the attempts went through, so the subscription has been marked unpaid and the workspace is now paused.",
      "Nothing has been deleted. Your contacts, conversations, flows and knowledge base are exactly as you left them, and everything switches back on the moment a payment clears.",
    ],
    highlight: "You can still sign in and read everything while it's paused — sending broadcast campaigns is what stops.",
    cta: { label: "Reactivate your subscription", href: FIX_BILLING },
    secondary: { label: "Talk to us instead", href: "/contact" },
    footerReason: "You're getting this because you own a Talko AI workspace whose subscription went unpaid. It's a one-off notice, not a recurring email.",
  }, SITE_URL);

  const result = await sendEmail({ to: tenant.ownerEmail, subject: "Your Talko AI workspace is paused", html, text });
  if (!result.ok) console.error("[dunning] suspended send failed", tenant.id, result.error);
  return result.ok;
}
