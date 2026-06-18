import {
  getCampaign, updateCampaign, enqueue, claimPending, markQueue, releaseQueueClaims, countPending, countQueueTotal,
  logCounts, sentLast24h, recipientsForAudience, getDueScheduledSends, markScheduled, armFlow,
  type Campaign,
} from "./store";
import { sendCampaign, getCreds } from "./whatsapp";
import { credsFor, getChannel, isMarketingSendable, tierDailyCap, type Channel } from "./channels";

const CHUNK = Math.max(1, parseInt(process.env.WA_SEND_CHUNK ?? "80", 10));

// Operator safety cap (env). The EFFECTIVE per-24h cap is the smaller of this and
// the number's real Meta tier, so a fresh/low-tier number can't overshoot Meta.
function safetyCap(): number { return parseInt(process.env.WA_DAILY_LIMIT ?? "900", 10); }
function effectiveCap(ch: Channel | null): number {
  const tier = tierDailyCap(ch?.messagingTier);
  return tier == null ? safetyCap() : Math.min(safetyCap(), tier);
}

// Bucket claimed queue rows by their per-recipient send outcome. sendCampaign
// returns one result per recipient it PROCESSED, in claim order; rows at indices
// past results.length were never attempted (early-abort after 5 consecutive
// failures) and are bucketed "unattempted" so the caller leaves them queued for
// retry instead of marking them sent (the BUG-2 data-loss the audit flagged).
export function bucketQueueOutcomes(
  chunk: { id: string; phone: string }[],
  results: { status: "sent" | "failed" | "skipped" }[],
): { sentIds: string[]; failedIds: string[]; skippedIds: string[]; unattemptedIds: string[]; sentPhones: string[] } {
  const sentIds: string[] = [], failedIds: string[] = [], skippedIds: string[] = [], unattemptedIds: string[] = [], sentPhones: string[] = [];
  chunk.forEach((c, i) => {
    const outcome = results[i]?.status;
    if (outcome === "sent") { sentIds.push(c.id); sentPhones.push(c.phone); }
    else if (outcome === "failed") failedIds.push(c.id);
    else if (outcome === "skipped") skippedIds.push(c.id);
    else unattemptedIds.push(c.id);
  });
  return { sentIds, failedIds, skippedIds, unattemptedIds, sentPhones };
}

export interface DrainResult { sentNow: number; queuedRemaining: number; status: Campaign["status"] }

// Sends one chunk of a campaign's pending queue, respecting the daily cap, then
// recomputes counters from the log.
export async function drainQueue(campaignId: string, maxToSend = CHUNK): Promise<DrainResult> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { sentNow: 0, queuedRemaining: 0, status: "failed" };

  // Anti-ban gate: if this campaign's number is RED / FLAGGED (or admin-paused),
  // hold marketing sends. We keep status "sending" so it auto-resumes once Meta
  // health recovers (a webhook clears marketing_paused). Env single-number mode
  // (no channelId / no row) can't be gated here, so it falls through.
  const ch = campaign.channelId ? await getChannel(campaign.channelId, campaign.tenantId) : null;
  if (ch && !isMarketingSendable(ch)) {
    const queued = await countPending(campaignId);
    await updateCampaign(campaignId, { status: "sending", errorSummary: `Paused — number quality is ${ch.qualityRating ?? ch.messagingHealth ?? "degraded"}. Sending resumes automatically once Meta health recovers. (${queued} queued)` });
    return { sentNow: 0, queuedRemaining: queued, status: "sending" };
  }

  // Cap against the SMALLER of the operator safety cap and the number's real Meta
  // tier, counted over a trailing 24h (Meta's window is rolling, not calendar-day).
  const cap = effectiveCap(ch);
  const headroom = Math.max(0, cap - (await sentLast24h(campaign.tenantId)));
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
      // Mark each claimed row by its ACTUAL outcome. sendCampaign returns one
      // result per recipient it processed, in claim order; rows past results.length
      // were never attempted (early-abort after consecutive failures) and must NOT
      // be marked sent — release them so the next drain retries them instead of
      // silently dropping the recipients.
      const { sentIds, failedIds, skippedIds, unattemptedIds, sentPhones } = bucketQueueOutcomes(chunk, r.results);
      await markQueue(sentIds, "sent");
      await markQueue(failedIds, "failed");
      await markQueue(skippedIds, "skipped");
      await releaseQueueClaims(unattemptedIds);
      // Bot on broadcast: arm only the recipients we actually delivered to.
      if (campaign.replyFlowId && sentPhones.length) await armFlow(sentPhones, campaign.replyFlowId, campaign.id, campaign.tenantId).catch(() => undefined);
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
    ? (headroom <= 0 ? `24h send limit (${cap === Number.POSITIVE_INFINITY ? "unlimited" : cap}) reached — ${queuedRemaining} queued, resumes as the rolling window frees up.` : `${queuedRemaining} queued — sending in the background.`)
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
  const recipients = await recipientsForAudience({ mode: aud.mode, tag: aud.tag, key: aud.key, value: aud.value }, campaign.tenantId, true);
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
      const r = await sendCampaign({
        campaignId: campaign.id,
        templateName: campaign.templateName,
        languageCode: campaign.languageCode,
        variables: campaign.variables,
        recipients: group.map(d => ({ phone: d.phone, fullName: d.recipientName })),
        headerImageUrl: campaign.headerImageUrl,
        channel: await credsFor(campaign.channelId),
        tenantId: campaign.tenantId,
      });
      // Mark each scheduled send by its real outcome (in send order). Items past
      // results.length were never attempted (early-abort) — leave them 'pending'
      // so the next run retries them rather than dropping them.
      const sentPhones: string[] = [];
      for (let i = 0; i < group.length; i++) {
        const outcome = r.results[i]?.status;
        if (outcome === "sent") { await markScheduled(group[i].id, "sent"); sent++; sentPhones.push(group[i].phone); }
        else if (outcome === "skipped") { await markScheduled(group[i].id, "skipped"); }
        else if (outcome === "failed") { await markScheduled(group[i].id, "failed", "send failed"); failed++; }
      }
      if (campaign.replyFlowId && sentPhones.length) await armFlow(sentPhones, campaign.replyFlowId, campaign.id, campaign.tenantId).catch(() => undefined);
    } catch (err) {
      for (const d of group) { await markScheduled(d.id, "failed", String(err)); failed++; }
    }
  }
  return { sent, failed };
}
