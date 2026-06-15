import { createCampaign, getCampaign, recipientsForAudience, type Campaign } from "./store";
import { startSend } from "./campaign";
import { getChannel } from "./channels";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export type BroadcastMode = "campaign" | "audience" | "recipients";

export interface BroadcastInput {
  mode: BroadcastMode;
  campaignId?: string;
  audience?: { mode: "all" | "tag" | "attribute"; tag?: string; key?: string; value?: string };
  recipients?: { phone?: string; name?: string }[];
  name?: string;
  templateName?: string;
  languageCode?: string;
  variables?: string[];
  headerImageUrl?: string | null;
  scheduledFor?: string | null;
  channelId?: string | null;     // which WhatsApp number to send from
}

export interface BroadcastResult {
  success: boolean;
  campaignId?: string;
  status?: Campaign["status"] | "scheduled";
  totalRecipients?: number;
  sent?: number;
  queuedRemaining?: number;
  message: string;
}

export class BroadcastError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new BroadcastError(m); }

export async function runBroadcast(input: BroadcastInput, tenantId = DEFAULT_TENANT_ID): Promise<BroadcastResult> {
  assert(input && typeof input === "object", "Body must be a JSON object.");
  assert(["campaign", "audience", "recipients"].includes(input.mode), 'mode must be "campaign", "audience", or "recipients".');

  // A client-supplied channelId must belong to the caller's tenant — otherwise
  // it would be persisted on the campaign and used to send from another tenant's
  // WhatsApp number (cross-tenant credential abuse / mis-billing).
  if (input.channelId) {
    const owned = await getChannel(input.channelId, tenantId);
    assert(owned, "Channel not found.");
  }

  // Trigger an existing campaign — recompute its audience and send now.
  if (input.mode === "campaign") {
    assert(input.campaignId, "campaignId is required for mode 'campaign'.");
    const campaign = await getCampaign(input.campaignId!, tenantId);
    assert(campaign, "Campaign not found.");
    const aud = campaign!.audience;
    assert(aud && aud.mode !== "recipients", "Campaign has no audience filter to recompute.");
    const recipients = await recipientsForAudience({ mode: aud!.mode as "all" | "tag" | "attribute", tag: aud!.tag, key: aud!.key, value: aud!.value }, tenantId);
    const r = await startSend(campaign!, recipients);
    return { success: true, campaignId: campaign!.id, status: r.status, totalRecipients: recipients.length, sent: r.sentNow, queuedRemaining: r.queuedRemaining, message: r.message };
  }

  assert(input.templateName?.trim(), "templateName is required.");
  const languageCode = input.languageCode?.trim() || "en_US";
  const variables = Array.isArray(input.variables) ? input.variables : [];

  let recipients: { phone: string; fullName: string }[];
  let audience: Campaign["audience"];

  if (input.mode === "audience") {
    const a = input.audience;
    assert(a && (a.mode === "all" || a.mode === "tag" || a.mode === "attribute"), "audience.mode must be 'all', 'tag', or 'attribute'.");
    assert(a!.mode !== "attribute" || a!.key?.trim(), "audience.key is required for mode 'attribute'.");
    audience = { mode: a!.mode, ...(a!.tag ? { tag: a!.tag } : {}), ...(a!.key ? { key: a!.key, value: a!.value ?? "" } : {}) };
    recipients = await recipientsForAudience({ mode: a!.mode, tag: a!.tag, key: a!.key, value: a!.value }, tenantId);
  } else {
    assert(Array.isArray(input.recipients) && input.recipients.length > 0, "recipients must be a non-empty array.");
    assert(!input.scheduledFor, "scheduledFor is not supported with explicit recipients — use mode 'audience'.");
    audience = { mode: "recipients" };
    recipients = input.recipients!.filter(r => r.phone?.trim()).map(r => ({ phone: r.phone!.trim(), fullName: (r.name ?? "").trim() }));
  }

  assert(recipients.length > 0, "No recipients matched.");

  // Schedule (audience mode only).
  if (input.scheduledFor) {
    const when = new Date(input.scheduledFor);
    assert(!isNaN(when.getTime()) && when.getTime() > Date.now(), "scheduledFor must be a future ISO timestamp.");
    const campaign = await createCampaign({
      name: input.name, templateName: input.templateName!.trim(), languageCode, variables,
      headerImageUrl: input.headerImageUrl ?? null, audience, status: "scheduled",
      totalRecipients: recipients.length, scheduledFor: when.toISOString(),
      channelId: input.channelId ?? null,
    }, tenantId);
    return { success: true, campaignId: campaign.id, status: "scheduled", totalRecipients: recipients.length, message: `Scheduled ${recipients.length} for ${when.toISOString()}.` };
  }

  const campaign = await createCampaign({
    name: input.name, templateName: input.templateName!.trim(), languageCode, variables,
    headerImageUrl: input.headerImageUrl ?? null, audience, status: "sending", totalRecipients: recipients.length,
    channelId: input.channelId ?? null,
  }, tenantId);
  const r = await startSend(campaign, recipients);
  return { success: true, campaignId: campaign.id, status: r.status, totalRecipients: recipients.length, sent: r.sentNow, queuedRemaining: r.queuedRemaining, message: r.message };
}
