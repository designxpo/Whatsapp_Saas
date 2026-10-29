// One event from a connected tool, acted on once.
//
// Every connector reduces what its tool sends to the same shape — who, what
// happened, and the details — and from there it is one path: the person lands
// in Contacts (tagged, with the details as attributes), then the business's
// automations for that event run exactly as an /api/events call would (API
// rules, then api_event auto-sends). A connector never sends a message itself;
// the business decides what an order or a payment should say.
//
// Contacts brought in this way are NOT marked opted in: an order or a booking
// is not consent to marketing. Order, payment and booking updates go out on
// Utility templates, which do not need it.

import { db } from "../supabase";
import { upsertContacts, getContactByPhone, setContactAttributes } from "../store";
import { processEvent } from "../apirules";
import { fireTrigger } from "../autosend";
import { claimEvent, settleEvent, noteActivity, type Integration } from "./store";
import type { Json } from "./normalize";

export interface NormalizedEvent {
  /** "<kind>.<what happened>", e.g. "shopify.order_created" — what automations listen for. */
  eventKey: string;
  /** What happened (order, payment, booking id), so a retry is recognised. */
  externalId: string | null;
  /** WhatsApp-ready digits, or "" when the event has no reachable person. */
  phone: string;
  name?: string;
  email?: string;
  /** What an automation quotes as {{payload.x}}. */
  data: Json;
  /** Added to the contact, e.g. "Shopify customer". */
  tags?: string[];
  /** Written onto the contact, overwriting: the latest order number wins. */
  attributes?: Record<string, string>;
  /** Events whose still-pending messages to this person no longer apply. */
  cancels?: string[];
}

export interface IngestResult {
  eventKey: string;
  outcome: "processed" | "ignored" | "duplicate" | "failed";
  detail: string;
}

export async function ingestEvents(integration: Integration, events: NormalizedEvent[]): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  for (const e of events) out.push(await ingestOne(integration, e));
  const last = out[out.length - 1];
  if (last) {
    await noteActivity(integration, last.outcome === "failed"
      ? { error: `${last.eventKey}: ${last.detail}` }
      : { eventKey: last.eventKey }).catch(() => undefined);
  }
  return out;
}

async function ingestOne(integration: Integration, e: NormalizedEvent): Promise<IngestResult> {
  const tenantId = integration.tenantId;
  // An event with nobody to message is logged but not CLAIMED: a checkout is
  // created before the shopper types a phone number, and the update that
  // carries it must not be thrown away as a repeat of the first.
  const eventId = await claimEvent(integration, e.phone ? e : { ...e, externalId: null });
  if (!eventId) return { eventKey: e.eventKey, outcome: "duplicate", detail: "Already received — a retry, not acted on again." };

  const settle = async (outcome: IngestResult["outcome"], detail: string): Promise<IngestResult> => {
    await settleEvent(tenantId, eventId, outcome, detail).catch(() => undefined);
    return { eventKey: e.eventKey, outcome, detail };
  };

  if (!e.phone) return settle("ignored", "No WhatsApp number in this event, so nobody to message.");

  try {
    const cancelled = e.cancels?.length ? await cancelPending(tenantId, e.cancels, e.phone).catch(() => 0) : 0;
    await upsertContacts([{ phone: e.phone, name: e.name, email: e.email, tags: e.tags ?? [], attributes: e.attributes ?? {} }], integration.kind, tenantId);
    // upsertContacts keeps a known contact's old attribute values; the latest
    // order or payment must replace them.
    if (e.attributes && Object.keys(e.attributes).length) await setContactAttributes(e.phone, e.attributes, tenantId).catch(() => undefined);

    const rules = await processEvent({ event: e.eventKey, phone: e.phone, name: e.name, payload: e.data }, tenantId);
    const contact = await getContactByPhone(e.phone, tenantId).catch(() => null);
    const legacy = await fireTrigger({
      trigger: "api_event", triggerKey: e.eventKey,
      contactId: contact?.id ?? null, phone: e.phone, name: e.name ?? contact?.name ?? "",
    }, tenantId).catch(() => false);

    const scheduled = rules.filter(r => r.outcome === "scheduled").length + (legacy ? 1 : 0);
    const skipped = rules.filter(r => r.outcome !== "scheduled").map(r => `${r.rule}: ${r.detail ?? r.outcome}`);
    const detail = (scheduled
      ? `${scheduled} message${scheduled === 1 ? "" : "s"} scheduled.${skipped.length ? ` Skipped — ${skipped.join("; ")}` : ""}`
      : rules.length
        ? `No message sent — ${skipped.join("; ")}`
        : "Saved to Contacts. No automation is set up for this event yet.")
      + (cancelled ? ` Cancelled ${cancelled} pending message${cancelled === 1 ? "" : "s"} that no longer apply.` : "");
    return settle("processed", detail);
  } catch (err) {
    return settle("failed", err instanceof Error ? err.message : String(err));
  }
}

/** Cancel this person's still-pending messages for `eventKeys`; how many were cancelled. */
async function cancelPending(tenantId: string, eventKeys: string[], phone: string): Promise<number> {
  const { data: rules } = await db().from("wa_api_rules").select("id").eq("tenant_id", tenantId).in("event_key", eventKeys);
  const ids = ((rules ?? []) as { id: string }[]).map(r => r.id);
  if (!ids.length) return 0;
  const { data } = await db().from("wa_rule_sends")
    .update({ status: "cancelled", detail: "No longer applies — superseded by a later event", processed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).in("rule_id", ids).eq("phone", phone).eq("status", "pending").select("id");
  return (data ?? []).length;
}
