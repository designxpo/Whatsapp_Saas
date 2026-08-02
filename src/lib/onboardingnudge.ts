// Onboarding nudge — email a tenant's owner once, roughly 24h after signup,
// if they still haven't connected a single channel.
//
// The one-time-send guard is a real atomic claim (claimTenantSettingOnce),
// not a get-then-set — a plain check-then-write race under overlapping cron
// ticks (the */5 GitHub Actions pinger can overlap a slow run) would let two
// concurrent ticks both pass the check and double-email the same tenant. If
// the send itself then fails, the claim is released so a later tick retries
// instead of silently losing the nudge forever.

import { db } from "./supabase";
import { claimTenantSettingOnce, releaseTenantSetting } from "./store";
import { tenantsWithActiveChannel } from "./channels";
import { sendEmail } from "./email";
import { SITE_URL } from "./siteurl";

// Exported so the in-app banner fallback (src/app/api/admin/me/route.ts)
// gates on the exact same "how stale" rule — one number, one place to change.
export const ONBOARDING_STALE_MS = 24 * 60 * 60 * 1000;
const NUDGE_SENT_KEY = "onboarding_nudge_sent";

export async function drainOnboardingNudges(): Promise<number> {
  const cutoff = new Date(Date.now() - ONBOARDING_STALE_MS).toISOString();
  const { data: tenants } = await db().from("tenants")
    .select("id, owner_email, created_at")
    .lt("created_at", cutoff)
    .in("status", ["trialing", "active"]);
  if (!tenants?.length) return 0;

  const tenantIds = tenants.map(t => t.id as string);
  const withChannel = await tenantsWithActiveChannel(tenantIds);

  let sent = 0;
  for (const t of tenants) {
    const tenantId = t.id as string;
    const ownerEmail = t.owner_email as string | null;
    if (withChannel.has(tenantId) || !ownerEmail) continue;

    // Atomic claim: only the first caller to successfully insert this flag
    // for this tenant proceeds. A second, overlapping tick's insert fails
    // (unique tenant_id+key) and it moves on without sending anything.
    if (!(await claimTenantSettingOnce(tenantId, NUDGE_SENT_KEY))) continue;

    const result = await sendEmail({
      to: ownerEmail,
      subject: "Finish setting up Talko AI — it takes about 5 minutes",
      html: `
        <p>Hi there,</p>
        <p>You signed up for Talko AI, but no channel is connected yet — so nothing's automated for you yet either.</p>
        <p>It only takes about five minutes to connect WhatsApp, Instagram, or your website chat and see your first AI reply.</p>
        <p><a href="${SITE_URL}/login">Finish setup →</a></p>
        <p>Need a hand? Our <a href="${SITE_URL}/guides/getting-started">getting started guide</a> walks through it step by step.</p>
      `,
    });
    if (result.ok) {
      sent++;
    } else {
      console.error("[onboardingnudge] send failed", tenantId, result.error);
      // Release the claim — a transient send failure shouldn't permanently
      // disable this tenant's one-time nudge; let a later tick retry it.
      await releaseTenantSetting(tenantId, NUDGE_SENT_KEY).catch(() => undefined);
    }
  }
  return sent;
}
