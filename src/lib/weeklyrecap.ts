// Weekly recap email — a per-tenant digest (new conversations, AI replies sent,
// new leads captured) for the calendar week that JUST finished, with each number
// compared against the week before it.
//
// Deliberately its own small queries rather than reusing getAnalytics(), which
// aggregates far more (14-day charts, KB status, campaigns) than a recap needs
// at dashboard-page cost. The six counts here are all index-backed
// `head: true` COUNT queries, so the previous-week comparison costs roughly
// nothing on top of the current week's.
//
// One send per (tenant, completed week): the settings key embeds the completed
// week's Monday date, so claimTenantSettingOnce naturally "resets" every Monday
// without needing a separate cleanup job — the small number of settings rows
// this adds (one per tenant per week) is negligible at any realistic scale.

import { db } from "./supabase";
import { claimTenantSettingOnce, releaseTenantSetting } from "./store";
import { sendEmail } from "./email";
import { renderEmail, type EmailStat } from "./emailtemplate";
import { unsubscribeUrl, isUnsubscribed } from "./emailprefs";
import { SITE_URL } from "./siteurl";
import { SEND_FAILURE_PREFIX } from "./store";

interface Week { key: string; startISO: string; endISO: string }

function lastCompletedWeek(): { current: Week; previous: Week } {
  const now = new Date();
  const diffToMonday = (now.getUTCDay() + 6) % 7;   // days since this week's Monday (0=Sun..6=Sat)
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  const mondayBefore = (d: Date, weeks: number) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() - 7 * weeks);
    return x;
  };
  const lastMonday = mondayBefore(thisMonday, 1);
  const priorMonday = mondayBefore(thisMonday, 2);
  return {
    current: { key: lastMonday.toISOString().slice(0, 10), startISO: lastMonday.toISOString(), endISO: thisMonday.toISOString() },
    previous: { key: priorMonday.toISOString().slice(0, 10), startISO: priorMonday.toISOString(), endISO: lastMonday.toISOString() },
  };
}

// "28 Jul – 3 Aug 2026". endISO is the exclusive end of the window (the
// following Monday), so the label shows the Sunday before it — otherwise every
// recap would claim to cover a day it has no data for.
function weekLabel(w: Week): string {
  const fmt = (d: Date, withYear = false) => d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}),
  });
  const start = new Date(w.startISO);
  const lastDay = new Date(new Date(w.endISO).getTime() - 86_400_000);
  return `${fmt(start)} – ${fmt(lastDay, true)}`;
}

async function countSince(table: string, tenantId: string, startISO: string, endISO: string, eq: Record<string, unknown> = {}, excludeBodyPrefix?: string): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId).gte("created_at", startISO).lt("created_at", endISO);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  if (excludeBodyPrefix) q = q.not("body", "like", `${excludeBodyPrefix}%`);
  const { count } = await q;
  return count ?? 0;
}

interface Counts { conversations: number; aiReplies: number; leads: number }

async function countWeek(tenantId: string, w: Week): Promise<Counts> {
  const [conversations, aiReplies, leads] = await Promise.all([
    countSince("wa_conversations", tenantId, w.startISO, w.endISO),
    // Exclude delivery-failure notes: they're source:"bot" too, and counting them
    // would both inflate this number and mask the zero-AI-replies alarm below —
    // the one signal that catches a workspace where nothing is getting through.
    countSince("wa_conv_messages", tenantId, w.startISO, w.endISO, { source: "bot" }, SEND_FAILURE_PREFIX),
    countSince("contacts", tenantId, w.startISO, w.endISO),
  ]);
  return { conversations, aiReplies, leads };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Week-on-week movement. Omitted entirely when there's nothing to compare
// against — "+3 vs last week" beside a workspace's very first recap reads as a
// measurement rather than the artefact of an empty baseline.
function delta(now: number, before: number): string | undefined {
  if (before === 0) return now === 0 ? undefined : "first activity";
  const diff = now - before;
  if (diff === 0) return "same as the week before";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs the week before`;
}

/**
 * The one thing worth saying about these numbers, plus the action that follows
 * from it. Ordered by how much the reader stands to gain from hearing it — a
 * misconfiguration they can't see beats a compliment about volume.
 */
function insight(c: Counts): { highlight: string; secondary: { label: string; href: string } } {
  if (c.conversations > 0 && c.aiReplies === 0) {
    return {
      highlight: `Worth a look: ${plural(c.conversations, "conversation", "conversations")} came in last week, but AI replies sent nothing. That usually means the AI provider key is missing or the knowledge base is empty — both take a couple of minutes to fix.`,
      secondary: { label: "Fix AI replies", href: "/guides/troubleshooting" },
    };
  }
  if (c.leads > 0) {
    return {
      highlight: `You captured ${plural(c.leads, "new lead", "new leads")} last week. A drip sequence is what turns those into conversations without anyone remembering to follow up.`,
      secondary: { label: "Set up a follow-up sequence", href: "/guides" },
    };
  }
  if (c.aiReplies > 0) {
    return {
      highlight: `That's ${plural(c.aiReplies, "reply", "replies")} your team didn't have to write — answered from your own knowledge base, at whatever hour they came in.`,
      secondary: { label: "See what else you can automate", href: "/features" },
    };
  }
  return {
    highlight: "Quiet week. If you haven't switched on comment automation or a welcome message yet, those are the two that bring conversations in rather than waiting for them.",
    secondary: { label: "Browse the setup guides", href: "/guides" },
  };
}

export async function drainWeeklyRecaps(): Promise<number> {
  const { current, previous } = lastCompletedWeek();
  const settingsKey = `weekly_recap:${current.key}`;
  const label = weekLabel(current);

  const { data: tenants } = await db().from("tenants").select("id, owner_email").in("status", ["trialing", "active"]);
  if (!tenants?.length) return 0;

  let sent = 0;
  for (const t of tenants) {
    const tenantId = t.id as string;
    const ownerEmail = t.owner_email as string | null;
    if (!ownerEmail) continue;

    const now = await countWeek(tenantId, current);
    // Nothing happened — don't claim the week yet, so a tenant whose activity
    // only picks up later that same week still gets recomputed and sent.
    if (now.conversations === 0 && now.aiReplies === 0 && now.leads === 0) continue;

    // Checked after the activity test and before the claim: an opted-out tenant
    // should neither be emailed nor have its week marked as sent, so re-
    // subscribing mid-week still delivers that week's recap.
    if (await isUnsubscribed(tenantId, "weekly_recap")) continue;

    if (!(await claimTenantSettingOnce(tenantId, settingsKey))) continue;   // already sent (or in flight) for this week

    const before = await countWeek(tenantId, previous);
    const stats: EmailStat[] = [
      { value: String(now.conversations), label: now.conversations === 1 ? "new conversation" : "new conversations", delta: delta(now.conversations, before.conversations) },
      { value: String(now.aiReplies), label: now.aiReplies === 1 ? "AI reply sent" : "AI replies sent", delta: delta(now.aiReplies, before.aiReplies) },
      { value: String(now.leads), label: now.leads === 1 ? "new lead" : "new leads", delta: delta(now.leads, before.leads) },
    ];
    const { highlight, secondary } = insight(now);
    const unsub = unsubscribeUrl(tenantId, "weekly_recap");

    // Number-led subject: the recipient can decide whether to open it from the
    // inbox list, which is the point of a recap. The preheader carries the date
    // range instead of repeating the subject.
    const subject = now.leads > 0
      ? `Your week: ${plural(now.conversations, "conversation", "conversations")}, ${plural(now.leads, "new lead", "new leads")}`
      : `Your week: ${plural(now.conversations, "conversation", "conversations")}, ${plural(now.aiReplies, "AI reply", "AI replies")}`;

    const { html, text } = renderEmail({
      preheader: `${label} · your Talko AI recap, and the one thing worth doing next.`,
      heading: "Your week on Talko AI",
      paragraphs: [`Here's what ran on autopilot between ${label}.`],
      stats,
      highlight,
      cta: { label: "Open your inbox", href: "/login" },
      secondary,
      footerReason: "You're getting this because you own a Talko AI workspace. It's a weekly summary, sent once a week and never more.",
      unsubscribeHref: unsub,
    }, SITE_URL);

    const result = await sendEmail({ to: ownerEmail, subject, html, text, unsubscribeUrl: unsub, type: "weekly_recap", tenantId });
    if (result.ok) {
      sent++;
    } else {
      console.error("[weeklyrecap] send failed", tenantId, result.error);
      // Release so a later tick this same week retries instead of losing it.
      await releaseTenantSetting(tenantId, settingsKey).catch(() => undefined);
    }
  }
  return sent;
}
