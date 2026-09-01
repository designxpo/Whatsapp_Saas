import { DEFAULT_TENANT_ID } from "./tenant";
import { createCampaign, getCampaign, recipientsForAudience, type Campaign } from "./store";
import { startSend } from "./campaign";
import { getChannel, credsFor } from "./channels";
import { fetchTemplates, type WaTemplate } from "./whatsapp";
import { templateIssues } from "./preflight";
import { assertImageAllowed } from "./moderation";


// Look the chosen template up on the WhatsApp Business Account it will actually
// be sent from.
//
// This used to return a bare `null` for two situations that need opposite
// handling, and the caller could not tell them apart:
//
//   • we could not CHECK (missing creds, Meta unreachable) — must not block
//   • the template is genuinely NOT on this number's account — must block
//
// Since both collapsed to null and the caller guarded with `if (tpl)`, the
// second case skipped validation entirely. That is the wrong-number bug:
// templates belong to ONE account, the composer reloads its list when the
// number changes but keeps the chosen NAME, and Meta then accepts the broadcast
// and rejects every message with (#132001) during the queue drain — minutes
// after the composer said "Sent to N recipients." Nothing arrives; nothing says so.
//
// The old language fallback (`?? tpls.find(t => t.name === name)`) hid a second
// version of it: a template present only in `hi` satisfied a request for
// `en_US`, and preflight waved through a send Meta would reject.
type TemplateLookup =
  | { kind: "found"; tpl: WaTemplate }
  | { kind: "absent"; approvedHere: string[] }
  | { kind: "wrongLanguage"; languages: string[] }
  | { kind: "unknown" };

async function lookUpTemplate(name: string, lang: string, channelId: string | null, tenantId: string): Promise<TemplateLookup> {
  let tpls: WaTemplate[];
  try {
    tpls = await fetchTemplates(await credsFor(channelId, tenantId));
  } catch {
    return { kind: "unknown" };   // could not verify — say so, don't guess
  }
  const exact = tpls.find(t => t.name === name && t.language === lang);
  if (exact) return { kind: "found", tpl: exact };
  const sameName = tpls.filter(t => t.name === name);
  if (sameName.length > 0) return { kind: "wrongLanguage", languages: sameName.map(t => t.language) };
  return { kind: "absent", approvedHere: tpls.filter(t => t.status === "APPROVED").slice(0, 3).map(t => t.name) };
}

export type BroadcastMode = "campaign" | "audience" | "recipients";

export interface BroadcastInput {
  mode: BroadcastMode;
  campaignId?: string;
  audience?: { mode: "all" | "tag" | "attribute" | "batch"; tag?: string; key?: string; value?: string; batchId?: string };
  recipients?: { phone?: string; name?: string }[];
  name?: string;
  templateName?: string;
  languageCode?: string;
  variables?: string[];
  headerImageUrl?: string | null;
  scheduledFor?: string | null;
  channelId?: string | null;     // which WhatsApp number to send from
  replyFlowId?: string | null;   // flow to start when a recipient replies
}

export interface BroadcastResult {
  success: boolean;
  campaignId?: string;
  status?: Campaign["status"] | "scheduled";
  totalRecipients?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  queuedRemaining?: number;
  message: string;
  // Why nothing (or not everything) went out. Populated whenever there is a
  // reason to give — callers should show this in preference to `message`.
  error?: string;
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

  // The header image is a PASTED URL (never routed through /api/upload), and a
  // broadcast fans it out to thousands of customers at once — the highest-blast-
  // radius media path in the product, so it's screened before any send starts.
  if (input.headerImageUrl?.trim()) {
    await assertImageAllowed(input.headerImageUrl.trim(), { tenantId, surface: "broadcast_media" });
  }

  // Trigger an existing campaign — recompute its audience and send now.
  if (input.mode === "campaign") {
    assert(input.campaignId, "campaignId is required for mode 'campaign'.");
    const campaign = await getCampaign(input.campaignId!, tenantId);
    assert(campaign, "Campaign not found.");
    const aud = campaign!.audience;
    assert(aud && aud.mode !== "recipients", "Campaign has no audience filter to recompute.");
    const recipients = await recipientsForAudience({ mode: aud!.mode as "all" | "tag" | "attribute" | "batch", tag: aud!.tag, key: aud!.key, value: aud!.value, batchId: aud!.batchId }, tenantId, true);
    const r = await startSend(campaign!, recipients);
    return { success: true, campaignId: campaign!.id, status: r.status, totalRecipients: recipients.length, sent: r.sentNow, queuedRemaining: r.queuedRemaining, message: r.message };
  }

  assert(input.templateName?.trim(), "templateName is required.");
  const languageCode = input.languageCode?.trim() || "en_US";
  const variables = Array.isArray(input.variables) ? input.variables : [];

  // Preflight against Meta's template definition — turn a silent rejection
  // (carousel template, missing {{n}} values, missing header media) into a
  // clear, plain-English error instead of a broadcast that quietly fails.
  const look = await lookUpTemplate(input.templateName!.trim(), languageCode, input.channelId ?? null, tenantId);
  if (look.kind === "absent") {
    assert(false, `The template "${input.templateName!.trim()}" doesn't exist on this number's WhatsApp Business Account, so Meta would reject every message (#132001). Templates belong to one account — pick a template from this number's list, or switch back to the number you chose it on.`
      + (look.approvedHere.length ? ` Approved here: ${look.approvedHere.join(", ")}.` : ""));
  }
  if (look.kind === "wrongLanguage") {
    assert(false, `"${input.templateName!.trim()}" exists on this number but not in ${languageCode}. Available languages: ${look.languages.join(", ")}.`);
  }
  if (look.kind === "found") {
    const { blocking } = templateIssues(look.tpl, { bodyParams: variables, headerImageUrl: input.headerImageUrl }, "broadcast");
    assert(blocking.length === 0, blocking[0]);
  }
  // kind === "unknown" falls through deliberately: not being able to verify a
  // template is not evidence the template is wrong, and a guard that cannot run
  // must not become an outage.

  let recipients: { phone: string; fullName: string }[];
  let audience: Campaign["audience"];

  if (input.mode === "audience") {
    const a = input.audience;
    assert(a && (a.mode === "all" || a.mode === "tag" || a.mode === "attribute" || a.mode === "batch"), "audience.mode must be 'all', 'tag', 'attribute', or 'batch'.");
    assert(a!.mode !== "attribute" || a!.key?.trim(), "audience.key is required for mode 'attribute'.");
    assert(a!.mode !== "batch" || a!.batchId?.trim(), "audience.batchId is required for mode 'batch'.");
    audience = { mode: a!.mode, ...(a!.tag ? { tag: a!.tag } : {}), ...(a!.key ? { key: a!.key, value: a!.value ?? "" } : {}), ...(a!.batchId ? { batchId: a!.batchId } : {}) };
    recipients = await recipientsForAudience({ mode: a!.mode, tag: a!.tag, key: a!.key, value: a!.value, batchId: a!.batchId }, tenantId, true);
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
      channelId: input.channelId ?? null, replyFlowId: input.replyFlowId ?? null,
    }, tenantId);
    return { success: true, campaignId: campaign.id, status: "scheduled", totalRecipients: recipients.length, message: `Scheduled ${recipients.length} for ${when.toISOString()}.` };
  }

  const campaign = await createCampaign({
    name: input.name, templateName: input.templateName!.trim(), languageCode, variables,
    headerImageUrl: input.headerImageUrl ?? null, audience, status: "sending", totalRecipients: recipients.length,
    channelId: input.channelId ?? null, replyFlowId: input.replyFlowId ?? null,
  }, tenantId);
  const r = await startSend(campaign, recipients);
  // A broadcast that reached NOBODY is not a success. Reporting success:true
  // with "Sent to 0 recipients." is how a wrong-WABA template ((#132001)), a
  // payment-blocked number (141006), a quality pause and an empty audience all
  // came out looking identical, with the real reason left in the log.
  const reachedNobody = r.sentNow === 0 && r.queuedRemaining === 0 && recipients.length > 0;
  return {
    success: !reachedNobody,
    campaignId: campaign.id, status: r.status,
    totalRecipients: recipients.length, sent: r.sentNow,
    failed: r.failed, skipped: r.skipped,
    queuedRemaining: r.queuedRemaining,
    message: r.message,
    ...(r.reason ? { error: r.reason } : {}),
  };
}
