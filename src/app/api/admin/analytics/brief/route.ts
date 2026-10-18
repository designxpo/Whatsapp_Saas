import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { getAnalytics } from "@/lib/store";
import { generateExecutiveBrief } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call — must outlast Vercel's ~10s default

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// POST — an AI CEO brief from this-week-vs-last platform metrics (tenant-scoped).
export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pinned to 14 days, not the dashboard default: the week-over-week split below
  // halves the daily buckets, which is only "this week vs last week" when there are
  // exactly 14 of them.
  const a = await getAnalytics(tid, "14d");
  const sum = (rows: typeof a.daily) => rows.reduce((s, d) => ({ sent: s.sent + d.sent, delivered: s.delivered + d.delivered, read: s.read + d.read, failed: s.failed + d.failed }), { sent: 0, delivered: 0, read: 0, failed: 0 });
  const prev = sum(a.daily.slice(0, 7));
  const cur = sum(a.daily.slice(7));
  const deltaPct = prev.sent > 0 ? Math.round(((cur.sent - prev.sent) / prev.sent) * 100) : (cur.sent > 0 ? 100 : 0);
  const optOutRate = rate(a.contacts.optedOut, a.contacts.active + a.contacts.optedOut);
  const escalationRate = rate(a.conversations.escalated, a.conversations.total);

  const lines = [
    `Active contacts: ${a.contacts.active} (opted out: ${a.contacts.optedOut}, opt-out rate ${optOutRate}%)`,
    `Messages sent — this week: ${cur.sent}, last week: ${prev.sent} (${deltaPct >= 0 ? "+" : ""}${deltaPct}% WoW)`,
    `This week delivery rate ${rate(cur.delivered, cur.sent)}%, read rate ${rate(cur.read, cur.sent)}%, failures ${cur.failed} (${rate(cur.failed, cur.sent + cur.failed)}%)`,
    `Last week delivery rate ${rate(prev.delivered, prev.sent)}%, read rate ${rate(prev.read, prev.sent)}%, failures ${prev.failed}`,
    `Replies from customers (${a.range.short}): ${a.messaging.repliedInRange}; AI auto-replies sent (${a.range.short}): ${a.messaging.aiRepliesInRange}`,
    `New contacts (${a.range.short}): ${a.contacts.newInRange}`,
    `Conversations: ${a.conversations.total} total, ${a.conversations.active} active, AI-handled ${a.conversations.botOn}, ${a.conversations.escalated} escalated (${escalationRate}%), ${a.conversations.needsReply} awaiting a reply`,
    `Channels: WhatsApp ${a.conversations.whatsapp} chats, Instagram ${a.conversations.instagram} chats, Facebook Messenger ${a.conversations.messenger} chats, Website live-chat ${a.conversations.webchat} chats`,
    `NOTE: "Messages sent" above counts OUTBOUND BROADCASTS only (WhatsApp template blasts). Website/Instagram/Messenger live chats and inbound replies are NOT broadcasts — measure two-way engagement from replies, AI replies and active conversations, not from broadcast volume.`,
    `Automation: ${a.automation.flowsActive}/${a.automation.flows} chatbot flows active, ${a.automation.sequencesActive}/${a.automation.sequences} drip sequences active, ${a.automation.activeEnrollments} people currently in drips`,
    `Campaigns: ${a.campaigns.total} broadcasts, ${a.campaigns.automations} auto-sends`,
    `Knowledge base: ${a.kb.ready}/${a.kb.documents} documents ready`,
  ].join("\n");

  try {
    const brief = await generateExecutiveBrief(lines, tid);
    return NextResponse.json({ brief, metrics: { cur, prev, deltaPct, optOutRate, escalationRate } });
  } catch (err) {
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace yet."
      : busy ? "AI is busy right now (model overloaded) — tap Generate to try again."
      : "Could not generate the brief — try again.";
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
