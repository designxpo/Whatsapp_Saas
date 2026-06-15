import {
  getCampaign, updateCampaign, enqueue, claimPending, markQueue, countPending, countQueueTotal,
  logCounts, dailySentCount, recipientsForAudience, getDueScheduledSends, markScheduled,
  type Campaign,
} from "./store";
import { sendCampaign, getCreds } from "./whatsapp";
import { credsFor } from "./channels";

const CHUNK = Math.max(1, parseInt(process.env.WA_SEND_CHUNK ?? "80", 10));

function dailyLimit(): number { return parseInt(process.env.WA_DAILY_LIMIT ?? "900", 10); }

export interface DrainResult { sentNow: number; queuedRemaining: number; status: Campaign["status"] }

// Sends one chunk of a campaign's pending queue, respecting the daily cap, then
// recomputes counters from the log.
export async function drainQueue(campaignId: string, maxToSend = CHUNK): Promise<DrainResult> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { sentNow: 0, queuedRemaining: 0, status: "failed" };

  const headroom = Math.max(0, dailyLimit() - (await dailySentCount(campaign.tenantId)));
  const claim = Math.min(maxToSend, headroom);
  let sentNow = 0;
  const errs: string[] = [];

  if (claim > 0) {
    const chunk = await claimPending(campaignId, claim);
    if (chunk.length > 0) {
      const r = await sendCampaign({
        campaignId,
        templateName: campaign.templateName,
        languageCode: campaign.languageCode,
        variables: campaign.variables,
        recipients: chunk.map(c => ({ phone: c.phone, fullName: c.fullName })),
        headerImageUrl: campaign.headerImageUrl,
        channel: await credsFor(campaign.channelId),
        tenantId: campaign.tenantId,
      });
      await markQueue(chunk.map(c => c.id), "sent");
      sentNow = r.sentCount;
      if (r.errors.length) errs.push(...r.errors);
    }
  }

  const counts = await logCounts(campaignId);
  const queuedRemaining = await countPending(campaignId);
  const queueTotal = await countQueueTotal(campaignId);
  const status: Campaign["status"] =
    queuedRemaining > 0 ? "sending" :
    counts.sent > 0 ? (counts.failed === 0 ? "sent" : "partial") :
    counts.failed > 0 ? "failed" : "sent";

  const errorSummary = queuedRemaining > 0
    ? (headroom <= 0 ? `Daily limit (${dailyLimit()}) reached — ${queuedRemaining} queued, resumes after reset.` : `${queuedRemaining} queued — sending in the background.`)
    : (counts.failed > 0 ? (errs.slice(0, 3).join(" | ") || `${counts.failed} failed`) : null);

  await updateCampaign(campaignId, {
    status, sentCount: counts.sent, failedCount: counts.failed,
    ...(queueTotal > 0 ? { totalRecipients: Math.max(queueTotal, counts.sent + counts.failed) } : {}),
    sentAt: campaign.sentAt ?? new Date().toISOString(), errorSummary,
  });

  return { sentNow, queuedRemaining, status };
}

export interface StartResult { enqueued: number; sentNow: number; queuedRemaining: number; status: Campaign["status"]; message: string }

export async function startSend(campaign: Campaign, recipients: { phone: string; fullName: string }[]): Promise<StartResult> {
  const { token, phoneId } = getCreds(await credsFor(campaign.channelId));
  if (!token || !phoneId) return { enqueued: 0, sentNow: 0, queuedRemaining: 0, status: campaign.status, message: "WhatsApp credentials not configured." };

  const enqueued = await enqueue(campaign.id, recipients, campaign.tenantId);
  if (enqueued === 0) return { enqueued: 0, sentNow: 0, queuedRemaining: await countPending(campaign.id), status: campaign.status, message: "No valid recipients." };

  await updateCampaign(campaign.id, { status: "sending", totalRecipients: recipients.length });
  const drain = await drainQueue(campaign.id);
  return {
    enqueued, sentNow: drain.sentNow, queuedRemaining: drain.queuedRemaining, status: drain.status,
    message: drain.queuedRemaining > 0
      ? `Queued ${enqueued} — ${drain.sentNow} sent now, ${drain.queuedRemaining} finishing in the background.`
      : `Sent to ${drain.sentNow} recipient${drain.sentNow !== 1 ? "s" : ""}.`,
  };
}

// Fires a scheduled campaign by recomputing its audience (all/tag).
export async function fireScheduledCampaign(campaign: Campaign): Promise<void> {
  await updateCampaign(campaign.id, { scheduledFor: null });
  const aud = campaign.audience;
  if (!aud || aud.mode === "recipients") {
    await updateCampaign(campaign.id, { status: "failed", errorSummary: "Scheduled campaign has no audience filter." });
    return;
  }
  const recipients = await recipientsForAudience({ mode: aud.mode, tag: aud.tag, key: aud.key, value: aud.value });
  if (recipients.length === 0) {
    await updateCampaign(campaign.id, { status: "sent", totalRecipients: 0, sentAt: new Date().toISOString(), errorSummary: "No recipients at fire time." });
    return;
  }
  await startSend(campaign, recipients);
}

// Processes due event-triggered auto-sends (grouped by their config campaign).
export async function drainAutoSends(maxItems = 150): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;
  const due = await getDueScheduledSends(maxItems);
  if (due.length === 0) return { sent, failed };

  const byCampaign = new Map<string, typeof due>();
  for (const d of due) { const g = byCampaign.get(d.campaignId) ?? []; g.push(d); byCampaign.set(d.campaignId, g); }

  for (const [cid, group] of byCampaign) {
    const campaign = await getCampaign(cid);
    if (!campaign) { for (const d of group) { await markScheduled(d.id, "failed", "config not found"); failed++; } continue; }
    try {
      await sendCampaign({
        campaignId: campaign.id,
        templateName: campaign.templateName,
        languageCode: campaign.languageCode,
        variables: campaign.variables,
        recipients: group.map(d => ({ phone: d.phone, fullName: d.recipientName })),
        headerImageUrl: campaign.headerImageUrl,
        channel: await credsFor(campaign.channelId),
        tenantId: campaign.tenantId,
      });
      for (const d of group) { await markScheduled(d.id, "sent"); sent++; }
    } catch (err) {
      for (const d of group) { await markScheduled(d.id, "failed", String(err)); failed++; }
    }
  }
  return { sent, failed };
}
