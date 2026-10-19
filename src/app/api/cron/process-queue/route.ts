import { runStagePoll, STAGE_POLL_KEY } from "@/lib/stagepoll";
import { tenantIdsWithSetting } from "@/lib/store";
import { accountCanSend as canPollStage } from "@/lib/feature-guard";
export const maxDuration = 300;
import { NextResponse, after } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { getDueScheduledCampaigns, campaignsWithPending, conversationsAwaitingReply, reflagReply, pruneEphemeral, getSetting, setSetting } from "@/lib/store";
import { fireScheduledCampaign, drainQueue, drainAutoSends } from "@/lib/campaign";
import { drainRuleSends } from "@/lib/apirules";
import { drainFlowReminders } from "@/lib/flowengine";
import { drainAdRules } from "@/lib/adrules";
import { drainSequences, drainInactiveLeads } from "@/lib/sequences";
import { drainAiFollowups } from "@/lib/followups";
import { drainCrmSync, crmSyncStats, flushCrmSessions } from "@/lib/leadsquared";
import { drainCrmOwnerSync } from "@/lib/handover";
import { drainAbandonedCarts } from "@/lib/commerce";
import { drainIntegrationDeliveries } from "@/lib/integrations";
import { refreshDueUrlDocuments } from "@/lib/kb";
import { respondToConversation } from "@/lib/assistant";
import { purgeOldAdChats } from "@/lib/adchats";
import { drainYtComments } from "@/lib/ytpoller";
import { drainGoogleReviews } from "@/lib/reviewpoller";
import { drainOnboardingNudges } from "@/lib/onboardingnudge";
import { drainWeeklyRecaps } from "@/lib/weeklyrecap";
import { drainOwnerEmailCampaigns } from "@/lib/ownerbroadcast";
import { drainEscalationSweeps } from "@/lib/escalations";
import { recordStageTick } from "@/lib/cronstages";
import { sweepInstagramTokens } from "@/lib/igtokensweep";

// SaaS runs on Vercel Hobby: NO vercel.json cron (it breaks deploys) — the
// GitHub Actions */5 pinger drives this route (CRON_URL + CRON_SECRET), hitting
// it with GET or POST and a Bearer CRON_SECRET header, which cronOk accepts.
// GET just delegates to POST. All work is idempotent.
export async function GET(req: Request) {
  return POST(req);
}

// Every stage the engine runs. Watched as a fixed list as well as by what a
// tick reaches, so a tick that dies early can't hide the stages it never got
// to. Add a stage here when you add one below.
const STAGES = [
  "autosends", "rulesends", "flowreminders", "adrules", "cartrecovery", "inactivity", "stagepoll",
  "sequences", "aifollowups", "crmsync", "crmsessions", "crmowners", "onboardingnudges", "weeklyrecaps",
  "ownerbroadcast", "escalationsweeps", "integrationdeliveries",
  "ytcomments", "googlereviews", "kbsync", "igtokens",
];

// POST /api/cron/process-queue — run on a schedule (*/5 GitHub Actions pinger).
// 1) fire due scheduled campaigns, 2) drain pending queues, 3) drain auto-sends.
export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  // Liveness heartbeat — owner health flags "cron stalled" when this goes stale.
  void setSetting("cron_last_tick", new Date().toISOString()).catch(() => undefined);
  const DEADLINE = 45_000;

  // Every stage reports whether it got its turn. A stage the deadline skips
  // doesn't fail and doesn't log — it just doesn't happen — so without this a
  // slow early stage can silently starve everything below it for days (it did:
  // see cronstages.ts). `declared` is every stage this tick knows about.
  const declared: string[] = [];
  const ran: string[] = [];
  async function stage<T>(name: string, fallback: T, fn: () => Promise<T>, budgetStart = startedAt, budget = DEADLINE): Promise<T> {
    declared.push(name);
    if (Date.now() - budgetStart >= budget) return fallback;
    ran.push(name);
    try { return await fn(); } catch (e) { console.error(`[cron] ${name}`, e); return fallback; }
  }

  // Pollers — YouTube comments, Google reviews, URL re-sync and the Instagram
  // token refresh — run AFTER the response, on a budget of their own.
  //
  // They used to sit at the bottom of the delivery stages and share DEADLINE
  // with them, so any slowdown above (a new per-tenant stage, a busy queue)
  // pushed them out of the tick without a trace. Nothing they do is on the
  // message-delivery path, so they lose nothing by going second — and message
  // delivery can no longer take their turn. Registered first so a failure in
  // the delivery stages can't skip them either.
  after(async () => {
    const pollStart = Date.now();
    const POLL_BUDGET = 120_000;   // + the ~50s above, well inside maxDuration
    const ytComments = await stage("ytcomments", 0, () => drainYtComments(), pollStart, POLL_BUDGET);
    const googleReviews = await stage("googlereviews", 0, () => drainGoogleReviews(), pollStart, POLL_BUDGET);
    const kbSync = await stage("kbsync", null, () => refreshDueUrlDocuments({ olderThanHours: 6, max: 3 }), pollStart, POLL_BUDGET);
    const igTokens = await stage("igtokens", null, () => sweepIgTokensIfDue(pollStart + POLL_BUDGET), pollStart, POLL_BUDGET);
    console.log(JSON.stringify({ tag: "cron_pollers", ytComments, googleReviews, kbSync, igTokens, tookMs: Date.now() - pollStart }));
    await recordStageTick(ran, [...new Set([...STAGES, ...declared])]);
  });

  try {
    let scheduledFired = 0;
    for (const c of await getDueScheduledCampaigns(25)) {
      if (Date.now() - startedAt > DEADLINE) break;
      try { await fireScheduledCampaign(c); scheduledFired++; } catch (e) { console.error("[cron] fire", c.id, e); }
    }

    // Drain campaigns CONCURRENTLY (atomic SKIP-LOCKED claims make this safe) so
    // one large/slow tenant can't starve everyone else within the cron budget.
    let sent = 0, queuesDrained = 0;
    const CONCURRENCY = Math.max(1, parseInt(process.env.WA_DRAIN_CONCURRENCY ?? "5", 10));
    const pending = await campaignsWithPending();
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      if (Date.now() - startedAt > DEADLINE) break;
      const batch = pending.slice(i, i + CONCURRENCY);
      const sentInBatch = await Promise.all(batch.map(async id => {
        try { return (await drainQueue(id)).sentNow; } catch (e) { console.error("[cron] drain", id, e); return 0; }
      }));
      sent += sentInBatch.reduce((a, b) => a + b, 0);
      queuesDrained += batch.length;
    }

    let autoSends = { sent: 0, failed: 0 };
    autoSends = await stage("autosends", autoSends, () => drainAutoSends());

    // API broadcasting rules — due rule-sends (delay/window elapsed).
    let ruleSends = { sent: 0, failed: 0, skipped: 0 };
    ruleSends = await stage("rulesends", ruleSends, () => drainRuleSends());

    // Flow no-reply reminders (waiting blocks with a reminder configured).
    let flowReminders = 0;
    flowReminders = await stage("flowreminders", flowReminders, () => drainFlowReminders());

    // Automated ad rules — budget/lead guardians against live insights.
    let adRules = { checked: 0, triggered: 0 };
    adRules = await stage("adrules", adRules, () => drainAdRules());

    // Abandoned carts → enroll into the cart-recovery sequence (before draining).
    let cartRecoveries = 0;
    cartRecoveries = await stage("cartrecovery", cartRecoveries, () => drainAbandonedCarts(60));

    // Inactivity re-engagement → enroll conversations that have gone quiet into
    // their tenant's "inactivity" nudge sequence (before draining, so a 0-delay
    // first step can fire on this same tick).
    let inactiveNudges = 0;
    inactiveNudges = await stage("inactivity", inactiveNudges, () => drainInactiveLeads(100));

    // LeadSquared stage poll — only for the workspaces that switched it on. Each
    // owns its poll watermark, credentials and observe/apply setting.
    //
    // This used to walk EVERY tenant (an entitlement lookup + a settings read
    // each) on every tick. Sixteen serial round trips was enough to push the
    // stages below past DEADLINE: from the deploy that added it, YouTube
    // comments, Google reviews, URL re-sync and everything after them silently
    // stopped running. One query for the opted-in few costs nothing.
    await stage("stagepoll", undefined, async () => {
      const workspaces = await tenantIdsWithSetting(STAGE_POLL_KEY, v => (v as { enabled?: unknown } | null)?.enabled === true);
      for (const id of workspaces) {
        if (Date.now() - startedAt >= DEADLINE) break;
        if (await canPollStage(id)) await runStagePoll({}, id).catch(e => console.error("[cron] stage poll", e));
      }
    });

    // Drip sequences — advance due enrollments one step (follow-ups, cart recovery).
    let sequences = 0;
    sequences = await stage("sequences", sequences, () => drainSequences(100));

    // AI follow-ups — re-engage chats that have gone quiet (the bot spoke last and
    // the customer never replied) with ONE short, context-aware AI nudge, INSIDE the
    // 24h window only. All channels, every tenant; stops on reply / human takeover.
    let aiFollowups = 0;
    aiFollowups = await stage("aifollowups", aiFollowups, () => drainAiFollowups(50));

    // Fallback: AI replies whose fire-and-forget job was dropped OR died mid-flight
    // (e.g. a slow voice transcription + reply that timed out the webhook function,
    // leaving needs_reply cleared by the claim but no reply ever sent). The
    // awaiting-reply sweep catches both; reflag each so respondToConversation can
    // re-claim it.
    let aiReplies = 0;
    if (process.env.LLM_BOT_ENABLED !== "false") {
      await stage("aireplies", undefined, async () => {
        for (const c of await conversationsAwaitingReply(20)) {
          if (Date.now() - startedAt > DEADLINE) break;
          try {
            await reflagReply(c.id);
            const r = await respondToConversation(c.id);
            if (r.outcome === "sent" || r.outcome === "escalated") aiReplies++;
          } catch (e) { console.error("[cron] aiReply", c.id, e); }
        }
      });
    }

    // CRM sync queue — replay LeadSquared pushes that failed retriably (outage,
    // rate limit, expired key) and pace campaign-blast timeline records. All
    // tenants; each row resolves its own tenant's credentials.
    let crmSync = { replayed: 0, deferred: 0, dead: 0, pending: 0, deadTotal: 0 };
    crmSync = await stage("crmsync", crmSync, async () => {
      const r = await drainCrmSync(100, startedAt + DEADLINE);
      const stats = await crmSyncStats();   // backlog visibility — dead rows must not be invisible
      return { ...r, pending: stats.pending, deadTotal: stats.dead };
    });

    // CRM session batching — combine each lead's buffered WhatsApp/chat messages
    // into ONE LeadSquared activity once the conversation has gone quiet, instead
    // of one timeline entry per message. All tenants.
    let crmSessions = { flushed: 0, deferred: 0 };
    crmSessions = await stage("crmsessions", crmSessions, () => flushCrmSessions(100, startedAt + DEADLINE));

    // LeadSquared ownership sweep — mirror who owns each lead in the CRM onto the
    // number that carries it here, so a hand-off made in LSQ lands in the portal
    // even when nobody configured the LSQ automation webhook. Reads only; writes
    // nothing unless an owner actually changed. Each workspace is self-throttled to
    // every 10 minutes on a rolling cursor, and OFF until that workspace switches
    // it on in Settings — it moves conversations between teams' inboxes.
    let crmOwners = { ran: false, checked: 0, moved: 0 } as Awaited<ReturnType<typeof drainCrmOwnerSync>>;
    crmOwners = await stage("crmowners", crmOwners, () => drainCrmOwnerSync(15));

    // YouTube comments, Google reviews and URL re-sync: see the after() block at
    // the top — they run once the response is sent, on their own budget.

    // Onboarding nudge — email a tenant's owner once if they signed up 24h+ ago
    // and still haven't connected a single channel. One-time per tenant.
    let onboardingNudges = 0;
    onboardingNudges = await stage("onboardingnudges", onboardingNudges, () => drainOnboardingNudges());

    // Weekly recap — a "here's what happened" email per tenant, once per
    // completed calendar week (only to tenants with something to report).
    let weeklyRecaps = 0;
    weeklyRecaps = await stage("weeklyrecaps", weeklyRecaps, () => drainWeeklyRecaps());

    // Owner → tenant email campaigns. Paced internally (Resend rate limit), so
    // a big announcement finishes across several ticks rather than in one.
    let ownerEmails = { sent: 0, failed: 0 };
    ownerEmails = await stage("ownerbroadcast", ownerEmails, () => drainOwnerEmailCampaigns());

    // Escalation clean-up — per tenant, for tenants that switched it on: chats
    // left escalated past their configured age go back to active with the bot
    // re-enabled, so the Escalated queue reflects what actually needs a human.
    // Each tenant self-throttles to its own interval.
    let escalationSweeps = { tenants: 0, reset: 0 };
    escalationSweeps = await stage("escalationsweeps", escalationSweeps, () => drainEscalationSweeps());

    // Integration deliveries — replay webhook / Slack / Teams / HubSpot /
    // Pipedrive events whose delivery failed retriably (endpoint 5xx, rate
    // limit, network), re-sending the SAME envelope so a receiver that dedupes
    // on X-Alabs-Delivery sees one event. All tenants; shares wa_crm_sync with
    // the CRM queue (kind 'integration').
    //
    // Runs LAST of the drains on purpose: each replay is a real outbound HTTP
    // call with a 6s timeout, so a tenant whose endpoint hangs would otherwise
    // burn the tick's deadline and starve everything below it. Batch is small
    // for the same reason — the queue drains across ticks, not within one.
    let integrationDeliveries = { replayed: 0, deferred: 0, dead: 0 };
    integrationDeliveries = await stage("integrationdeliveries", integrationDeliveries, () => drainIntegrationDeliveries(20, startedAt + DEADLINE));

    // Housekeeping: prune expired dedup + login-throttle rows (unbounded growth).
    try { await pruneEphemeral(); } catch (e) { console.error("[cron] prune", e); }

    // Housekeeping: expire AI ad-builder chat sessions older than 30 days, so the
    // history table can't grow unbounded (saved standing context lives elsewhere).
    let adChatsPurged = 0;
    try { adChatsPurged = await purgeOldAdChats(30); } catch (e) { console.error("[cron] adchatpurge", e); }

    return NextResponse.json({ scheduledFired, queuesDrained, sent, autoSends, ruleSends, flowReminders, adRules, cartRecoveries, inactiveNudges, sequences, aiFollowups, aiReplies, onboardingNudges, weeklyRecaps, ownerEmails, escalationSweeps, crmSync, crmSessions, crmOwners, integrationDeliveries, adChatsPurged, pollers: "after-response" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// The Instagram token sweep, at most every few hours. It also has its own daily
// GitHub job, but that job authenticates with a separate copy of CRON_SECRET —
// when the copy went stale (2026-10-03) the sweep silently stopped, and every
// Instagram token was left to expire at 60 days. This route is driven by
// pg_cron, which carries the live secret, so the sweep now rides on it too.
const IG_SWEEP_EVERY_MS = 6 * 3_600_000;
async function sweepIgTokensIfDue(deadlineAt: number): Promise<{ due: boolean; refreshed?: number; failed?: number }> {
  const last = Date.parse(await getSetting<string>("ig_token_sweep_at", ""));
  if (Number.isFinite(last) && Date.now() - last < IG_SWEEP_EVERY_MS) return { due: false };
  await setSetting("ig_token_sweep_at", new Date().toISOString());
  const r = await sweepInstagramTokens(deadlineAt);
  return { due: true, refreshed: r.refreshed, failed: r.failed };
}
