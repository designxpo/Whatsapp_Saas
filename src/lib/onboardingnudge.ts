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
import { renderEmail } from "./emailtemplate";
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

    // No unsubscribe link: this is a single onboarding message tied to an
    // account the recipient created, not a recurring stream — there is nothing
    // to unsubscribe FROM. It never sends twice (the claim above guarantees it).
    const { html, text } = renderEmail({
      preheader: "Your workspace is ready — it just needs one channel connected before it can reply to anyone.",
      heading: "Your Talko AI workspace is waiting on one thing",
      paragraphs: [
        "You created a workspace, but no channel is connected yet — so there's nothing for the AI to answer, and nothing arriving in your inbox.",
        "Connecting the first one is the only step that unlocks the rest. Pick whichever channel your customers already message you on:",
      ],
      steps: [
        "Connect a channel — WhatsApp, Instagram, Messenger, or paste one line of HTML for website chat. Roughly five minutes, most of it Meta's verification screens.",
        "Add your AI provider key (Gemini, OpenAI or Anthropic) so replies are billed to you at your provider's rates, with no markup from us.",
        "Send yourself a test message and watch the first AI reply come back.",
      ],
      highlight: "Nothing here needs a developer, and you can stop after step one — a connected channel already gives you the unified inbox and Live Chat, even before AI replies are switched on.",
      cta: { label: "Connect your first channel", href: "/login" },
      secondary: { label: "Read the getting-started guide", href: "/guides/getting-started" },
      footerReason: "You're getting this once because you created a Talko AI workspace and haven't connected a channel yet. We won't send it again.",
    }, SITE_URL);

    const result = await sendEmail({
      to: ownerEmail,
      subject: "One step left to switch on Talko AI",
      html,
      text,
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
