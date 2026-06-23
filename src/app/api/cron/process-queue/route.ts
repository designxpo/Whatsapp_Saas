export const maxDuration = 300;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { getDueScheduledCampaigns, campaignsWithPending, conversationsAwaitingReply, reflagReply, pruneEphemeral } from "@/lib/store";
import { fireScheduledCampaign, drainQueue, drainAutoSends } from "@/lib/campaign";
import { drainRuleSends } from "@/lib/apirules";
import { drainFlowReminders } from "@/lib/flowengine";
import { drainAdRules } from "@/lib/adrules";
import { drainSequences, drainInactiveLeads } from "@/lib/sequences";
import { drainAbandonedCarts } from "@/lib/commerce";
import { refreshDueUrlDocuments } from "@/lib/kb";
import { respondToConversation } from "@/lib/assistant";

// Vercel Cron invokes paths with a GET and an "Authorization: Bearer <CRON_SECRET>"
// header (set automatically from the CRON_SECRET env var) — which cronOk already
// accepts. So GET just delegates to the same work POST does, letting Vercel Cron
// (vercel.json, every minute) drive tight flow reminders reliably, while the
// GitHub Actions */5 pinger stays as a backup. All work is idempotent.
export async function GET(req: Request) {
  return POST(req);
}

// POST /api/cron/process-queue — run on a schedule (every minute via Vercel Cron).
// 1) fire due scheduled campaigns, 2) drain pending queues, 3) drain auto-sends.
export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  const DEADLINE = 45_000;

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
    if (Date.now() - startedAt < DEADLINE) {
      try { autoSends = await drainAutoSends(); } catch (e) { console.error("[cron] autosends", e); }
    }

    // API broadcasting rules — due rule-sends (delay/window elapsed).
    let ruleSends = { sent: 0, failed: 0, skipped: 0 };
    if (Date.now() - startedAt < DEADLINE) {
      try { ruleSends = await drainRuleSends(); } catch (e) { console.error("[cron] rulesends", e); }
    }

    // Flow no-reply reminders (waiting blocks with a reminder configured).
    let flowReminders = 0;
    if (Date.now() - startedAt < DEADLINE) {
      try { flowReminders = await drainFlowReminders(); } catch (e) { console.error("[cron] flowreminders", e); }
    }

    // Automated ad rules — budget/lead guardians against live insights.
    let adRules = { checked: 0, triggered: 0 };
    if (Date.now() - startedAt < DEADLINE) {
      try { adRules = await drainAdRules(); } catch (e) { console.error("[cron] adrules", e); }
    }

    // Abandoned carts → enroll into the cart-recovery sequence (before draining).
    let cartRecoveries = 0;
    if (Date.now() - startedAt < DEADLINE) {
      try { cartRecoveries = await drainAbandonedCarts(60); } catch (e) { console.error("[cron] cartrecovery", e); }
    }

    // Inactivity re-engagement → enroll conversations that have gone quiet into
    // their tenant's "inactivity" nudge sequence (before draining, so a 0-delay
    // first step can fire on this same tick).
    let inactiveNudges = 0;
    if (Date.now() - startedAt < DEADLINE) {
      try { inactiveNudges = await drainInactiveLeads(100); } catch (e) { console.error("[cron] inactivity", e); }
    }

    // Drip sequences — advance due enrollments one step (follow-ups, cart recovery).
    let sequences = 0;
    if (Date.now() - startedAt < DEADLINE) {
      try { sequences = await drainSequences(100); } catch (e) { console.error("[cron] sequences", e); }
    }

    // Fallback: AI replies whose fire-and-forget job was dropped OR died mid-flight
    // (e.g. a slow voice transcription + reply that timed out the webhook function,
    // leaving needs_reply cleared by the claim but no reply ever sent). The
    // awaiting-reply sweep catches both; reflag each so respondToConversation can
    // re-claim it.
    let aiReplies = 0;
    if (process.env.LLM_BOT_ENABLED !== "false") {
      for (const c of await conversationsAwaitingReply(20)) {
        if (Date.now() - startedAt > DEADLINE) break;
        try {
          await reflagReply(c.id);
          const r = await respondToConversation(c.id);
          if (r.outcome === "sent" || r.outcome === "escalated") aiReplies++;
        } catch (e) { console.error("[cron] aiReply", c.id, e); }
      }
    }

    // Knowledge-base auto-sync: re-crawl a few URL docs (any tenant) that are due
    // (re-embeds only when the page changed) so the KB tracks org source pages.
    let kbSync = { checked: 0, updated: 0, unchanged: 0, failed: 0 };
    if (Date.now() - startedAt < DEADLINE) {
      try { kbSync = await refreshDueUrlDocuments({ olderThanHours: 6, max: 3 }); } catch (e) { console.error("[cron] kbsync", e); }
    }

    // Housekeeping: prune expired dedup + login-throttle rows (unbounded growth).
    try { await pruneEphemeral(); } catch (e) { console.error("[cron] prune", e); }

    return NextResponse.json({ scheduledFired, queuesDrained, sent, autoSends, ruleSends, flowReminders, adRules, cartRecoveries, inactiveNudges, sequences, aiReplies, kbSync });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
