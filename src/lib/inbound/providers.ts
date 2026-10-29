// One connector per tool: is this delivery really from the tool, and what does
// it mean? Pure functions over the headers and body (plus an optional live
// credential test), so each tool's signature scheme and payload shape is pinned
// by tests rather than discovered in production.

import { findPerson, firstText, tagsFrom, slug, type Json } from "./normalize";
import type { NormalizedEvent } from "./ingest";
import { shopifyProvider } from "./connectors/shopify";
import { woocommerceProvider } from "./connectors/woocommerce";
import { razorpayProvider } from "./connectors/razorpay";
import { calendlyProvider } from "./connectors/calendly";
import { calcomProvider } from "./connectors/calcom";
import { typeformProvider } from "./connectors/typeform";
import { indiamartProvider } from "./connectors/indiamart";
import type { IntegrationSecrets } from "./store";

export interface InboundContext {
  headers: Headers;
  /** The body exactly as received: what every signature is computed over. */
  raw: string;
  body: Json;
  config: Record<string, string>;
  secrets: IntegrationSecrets;
}

export interface ConnectContext {
  /** This connection's public webhook URL. */
  webhookUrl: string;
  config: Record<string, string>;
  secrets: IntegrationSecrets;
}

/** What a connect step changed: settings and secrets to keep (e.g. a subscription id). */
export interface ConnectOutcome { ok: boolean; detail: string; config?: Record<string, string>; secrets?: Record<string, string> }

export interface Provider {
  /** null when the delivery is authentic, else why it is refused (shown to the business). */
  verify(ctx: InboundContext): string | null;
  /** What happened. Empty when the delivery is not something we act on (a ping, an unused topic). */
  parse(ctx: InboundContext): NormalizedEvent[];
  /**
   * Run when the business connects: a live check of their credentials, and for
   * tools whose webhooks exist only through their API (Calendly), creating the
   * subscription that points at us.
   */
  connect?(ctx: ConnectContext): Promise<ConnectOutcome>;
  /** Undo what connect set up in the tool, when the business disconnects. Best-effort. */
  disconnect?(config: Record<string, string>, secrets: IntegrationSecrets): Promise<void>;
}

// Never copied onto a contact: the person's own details already have fields,
// and anything credential-like has no business in an attribute.
const NOT_AN_ATTRIBUTE = /phone|mobile|whatsapp|email|^name$|first_name|last_name|token|secret|password|passcode|otp|signature|^id$/i;

/** String values of a flat-ish payload, for contact attributes. */
function flatStrings(o: Json, prefix = "", out: Record<string, string> = {}, depth = 0): Record<string, string> {
  for (const [k, v] of Object.entries(o)) {
    if (NOT_AN_ATTRIBUTE.test(k)) continue;
    const key = `${prefix}${k}`.slice(0, 60);
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = String(v).slice(0, 300);
    else if (v && typeof v === "object" && !Array.isArray(v) && depth < 1) flatStrings(v as Json, `${key}_`, out, depth + 1);
    if (Object.keys(out).length >= 30) break;
  }
  return out;
}

// ── Webhooks: Zapier, Make, Pabbly, n8n, website forms, anything ───────────
//
// The unguessable token in the URL is the credential, as it is for a Zapier
// catch hook. Each item in a JSON array is its own event, so a batch from a
// sheet or a form tool is not collapsed into one person.
export const webhookProvider: Provider = {
  verify: () => null,
  parse({ body, config }) {
    const items = Array.isArray(body.items) ? (body.items as unknown[]).filter((x): x is Json => !!x && typeof x === "object") : [body];
    return items.map(item => {
      const person = findPerson(item, {
        phonePath: config.phonePath, namePath: config.namePath, emailPath: config.emailPath,
        defaultCountryCode: config.defaultCountryCode,
      });
      const event = firstText(item, ["event", "event_name", "type"]) || config.eventName || "lead";
      return {
        eventKey: `webhook.${slug(event)}`,
        externalId: firstText(item, ["event_id", "eventId", "id", "submission_id", "response_id"]) || null,
        phone: person.phone, name: person.name, email: person.email,
        data: item,
        tags: tagsFrom(config.tags, "Webhook lead"),
        // Prefixed, so a payload can never overwrite an attribute the rest of
        // the portal depends on (lsq_lead_id, utm_source, fee_amount…).
        attributes: { ...Object.fromEntries(Object.entries(flatStrings(item)).map(([k, v]) => [`webhook_${k}`.slice(0, 60), v])), last_webhook_event: slug(event) },
      };
    });
  },
};

export const PROVIDERS: Record<string, Provider> = {
  webhook: webhookProvider,
  shopify: shopifyProvider,
  woocommerce: woocommerceProvider,
  razorpay: razorpayProvider,
  calendly: calendlyProvider,
  calcom: calcomProvider,
  typeform: typeformProvider,
  indiamart: indiamartProvider,
};
