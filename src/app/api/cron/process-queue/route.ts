export const maxDuration = 300;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { getDueScheduledCampaigns, campaignsWithPending, conversationsNeedingReply, pruneEphemeral } from "@/lib/store";
import { fireScheduledCampaign, drainQueue, drainAutoSends } from "@/lib/campaign";
import { drainRuleSends } from "@/lib/apirules";
import { drainFlowReminders } from "@/lib/flowengine";
import { drainAdRules } from "@/lib/adrules";
import { drainSequences } from "@/lib/sequences";
import { drainAbandonedCarts } from "@/lib/commerce";
import { respondToConversation } from "@/lib/assistant";

// POST /api/cron/process-queue — run on a schedule (every 5–15 min).
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

    let sent = 0, queuesDrained = 0;
    for (const id of await campaignsWithPending()) {
      if (Date.now() - startedAt > DEADLINE) break;
      try { const r = await drainQueue(id); sent += r.sentNow; queuesDrained++; } catch (e) { console.error("[cron] drain", id, e); }
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

    // Drip sequences — advance due enrollments one step (follow-ups, cart recovery).
    let sequences = 0;
    if (Date.now() - startedAt < DEADLINE) {
      try { sequences = await drainSequences(100); } catch (e) { console.error("[cron] sequences", e); }
    }

    // Fallback: AI replies whose fire-and-forget job was dropped.
    let aiReplies = 0;
    if (process.env.LLM_BOT_ENABLED !== "false") {
      for (const c of await conversationsNeedingReply(20)) {
        if (Date.now() - startedAt > DEADLINE) break;
        try { const r = await respondToConversation(c.id); if (r.outcome === "sent" || r.outcome === "escalated") aiReplies++; }
        catch (e) { console.error("[cron] aiReply", c.id, e); }
      }
    }

    // Housekeeping: prune expired dedup + login-throttle rows (unbounded growth).
    try { await pruneEphemeral(); } catch (e) { console.error("[cron] prune", e); }

    return NextResponse.json({ scheduledFired, queuesDrained, sent, autoSends, ruleSends, flowReminders, adRules, cartRecoveries, sequences, aiReplies });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
