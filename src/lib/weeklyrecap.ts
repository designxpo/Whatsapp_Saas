// Weekly recap email — a lightweight per-tenant digest (new conversations, AI
// replies sent, new leads captured) for the calendar week that JUST finished.
// Deliberately its own small queries rather than reusing getAnalytics(), which
// aggregates far more (14-day charts, KB status, campaigns) than a one-line
// recap needs at dashboard-page cost.
//
// One send per (tenant, completed week): the settings key embeds the
// completed week's Monday date, so claimTenantSettingOnce naturally "resets"
// every Monday without needing a separate cleanup job — the small number of
// settings rows this adds (one per tenant per week) is negligible at any
// realistic scale.

import { db } from "./supabase";
import { claimTenantSettingOnce, releaseTenantSetting } from "./store";
import { sendEmail } from "./email";
import { SITE_URL } from "./siteurl";

function lastCompletedWeek(): { key: string; startISO: string; endISO: string } {
  const now = new Date();
  const diffToMonday = (now.getUTCDay() + 6) % 7;   // days since this week's Monday (0=Sun..6=Sat)
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  return { key: lastMonday.toISOString().slice(0, 10), startISO: lastMonday.toISOString(), endISO: thisMonday.toISOString() };
}

async function countSince(table: string, tenantId: string, startISO: string, endISO: string, eq: Record<string, unknown> = {}): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId).gte("created_at", startISO).lt("created_at", endISO);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

export async function drainWeeklyRecaps(): Promise<number> {
  const week = lastCompletedWeek();
  const settingsKey = `weekly_recap:${week.key}`;

  const { data: tenants } = await db().from("tenants").select("id, owner_email").in("status", ["trialing", "active"]);
  if (!tenants?.length) return 0;

  let sent = 0;
  for (const t of tenants) {
    const tenantId = t.id as string;
    const ownerEmail = t.owner_email as string | null;
    if (!ownerEmail) continue;

    const [newConversations, aiReplies, newLeads] = await Promise.all([
      countSince("wa_conversations", tenantId, week.startISO, week.endISO),
      countSince("wa_conv_messages", tenantId, week.startISO, week.endISO, { source: "bot" }),
      countSince("contacts", tenantId, week.startISO, week.endISO),
    ]);
    // Nothing happened — don't claim the week yet, so a tenant whose activity
    // only picks up later that same week still gets recomputed and sent.
    if (newConversations === 0 && aiReplies === 0 && newLeads === 0) continue;

    if (!(await claimTenantSettingOnce(tenantId, settingsKey))) continue;   // already sent (or in flight) for this week

    const result = await sendEmail({
      to: ownerEmail,
      subject: "Your week on Talko AI",
      html: `
        <p>Hi there,</p>
        <p>Here's what Talko AI did for you last week:</p>
        <ul>
          <li><strong>${newConversations}</strong> new conversation${newConversations === 1 ? "" : "s"} started</li>
          <li><strong>${aiReplies}</strong> AI repl${aiReplies === 1 ? "y" : "ies"} sent</li>
          <li><strong>${newLeads}</strong> new lead${newLeads === 1 ? "" : "s"} captured</li>
        </ul>
        <p><a href="${SITE_URL}/login">Open your inbox →</a></p>
      `,
    });
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
