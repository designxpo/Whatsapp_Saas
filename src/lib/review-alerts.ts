// Review alerts — what a business owner should hear about without watching the
// Reviews tab: a new review, a reply waiting for approval, a complaint, a reply
// Google refused, lost Google access, a sync that keeps failing, and a review
// left unanswered too long.
//
// One row per alert in wa_review_alerts, unique per (tenant, dedupe_key): the
// key names the event ("review:<id>:arrived", "channel:<id>:reauth:<day>"), so
// a retried or concurrent job can't raise the same alert twice. The bell shows
// recent alerts that still need something; email goes out in one batch per
// workspace per run, each row claimed before sending so it is mailed once.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { applyEmailBrand } from "./email-brand";
import { brandForTenant } from "./brand-lookup";
import { unsubscribedRecipients, unsubscribeUrl } from "./emailprefs";
import { SITE_URL } from "./siteurl";
import { listUsers } from "./team";
import { getReviewSettings, type AlertKind } from "./reviews";

export interface ReviewAlert {
  id: string;
  kind: AlertKind;
  reviewId: string | null;
  channelId: string | null;
  title: string;
  body: string;
  createdAt: string;
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  new_review: "A new review arrives",
  needs_approval: "A reply is waiting for approval",
  complaint: "A complaint needs attention",
  post_failed: "A reply couldn't be posted to Google",
  reauth: "Google access expired or was revoked",
  sync_failing: "Reviews keep failing to sync",
  overdue: "A review stays unanswered",
};

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /wa_review_alerts/.test(e.message ?? ""));

/** A link that opens this review (or the Reviews tab) in the portal. */
export function alertHref(a: Pick<ReviewAlert, "reviewId">): string {
  return a.reviewId ? `/admin?tab=reviews&review=${encodeURIComponent(a.reviewId)}` : "/admin?tab=reviews";
}

/**
 * Raise an alert once. False when the workspace switched this kind off, it was
 * already raised (same dedupe key), or the table isn't there yet.
 */
export async function raiseAlert(tenantId: string, a: { kind: AlertKind; dedupeKey: string; reviewId?: string | null; channelId?: string | null; title: string; body?: string }): Promise<boolean> {
  const settings = await getReviewSettings(tenantId);
  if (!settings.alerts.events[a.kind]) return false;
  const { data, error } = await tdb(tenantId).from("wa_review_alerts").upsert({
    kind: a.kind, dedupe_key: a.dedupeKey.slice(0, 200), review_id: a.reviewId ?? null, channel_id: a.channelId ?? null,
    title: a.title.slice(0, 200), body: (a.body ?? "").slice(0, 600),
  }, { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) {
    if (!missingTable(error)) console.error("[review-alerts] raise", tenantId, a.kind, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Recent alerts that still need something, newest first, for the bell. An
 * alert about a review drops off once the review has a public reply; one about
 * a location drops off once that location syncs again.
 */
export async function openAlerts(tenantId: string, opts: { hours?: number; limit?: number; now?: number } = {}): Promise<ReviewAlert[]> {
  const since = new Date((opts.now ?? Date.now()) - (opts.hours ?? 72) * 3_600_000).toISOString();
  const { data, error } = await tdb(tenantId).from("wa_review_alerts")
    .select("id,kind,review_id,channel_id,title,body,created_at").gte("created_at", since)
    .order("created_at", { ascending: false }).limit(opts.limit ?? 30);
  if (error || !data?.length) return [];
  const rows = data as unknown as { id: string; kind: AlertKind; review_id: string | null; channel_id: string | null; title: string; body: string; created_at: string }[];
  const reviewIds = [...new Set(rows.map(r => r.review_id).filter((x): x is string => !!x))];
  const replied = new Set<string>();
  if (reviewIds.length) {
    const { data: rv } = await tdb(tenantId).from("wa_reviews").select("id,reply_status").in("id", reviewIds);
    for (const r of (rv ?? []) as unknown as { id: string; reply_status: string }[]) if (r.reply_status === "posted") replied.add(r.id);
  }
  const { getGoogleSyncStatus } = await import("./reviews");
  const sync = rows.some(r => r.kind === "reauth" || r.kind === "sync_failing") ? await getGoogleSyncStatus(tenantId) : {};
  return rows
    .filter(r => !(r.review_id && replied.has(r.review_id)))
    .filter(r => !((r.kind === "reauth" || r.kind === "sync_failing") && r.channel_id && sync[r.channel_id]?.ok))
    .map(r => ({ id: r.id, kind: r.kind, reviewId: r.review_id, channelId: r.channel_id, title: r.title, body: r.body, createdAt: r.created_at }));
}

/** Who gets review alert emails: the chosen addresses, else every admin. */
export async function alertRecipients(tenantId: string, chosen: string[]): Promise<string[]> {
  if (chosen.length) return [...new Set(chosen.map(e => e.trim().toLowerCase()))];
  const admins = (await listUsers(tenantId)).filter(u => u.active && u.role === "admin" && /@/.test(u.email ?? "")).map(u => u.email.trim().toLowerCase());
  return [...new Set(admins)];
}

export const emailConfigured = () => !!process.env.RESEND_API_KEY;

/**
 * Email this run's new alerts: one message per workspace listing them all.
 * Each row is claimed (emailed_at set) BEFORE sending, so two overlapping runs
 * can't both mail it. Workspaces with email alerts off are marked handled too,
 * so turning email on later doesn't flood them with old alerts.
 */
export async function drainAlertEmails(now = Date.now(), maxTenants = 25): Promise<{ tenants: number; emails: number }> {
  const since = new Date(now - 24 * 3_600_000).toISOString();
  const { data, error } = await db().from("wa_review_alerts")
    .select("id,tenant_id,kind,review_id,title,body,created_at").is("emailed_at", null).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(300);
  if (error || !data?.length) return { tenants: 0, emails: 0 };
  const byTenant = new Map<string, typeof data>();
  for (const r of data) byTenant.set(r.tenant_id as string, [...(byTenant.get(r.tenant_id as string) ?? []), r]);

  let tenants = 0, emails = 0;
  for (const [tenantId, rows] of byTenant) {
    if (tenants >= maxTenants) break;
    tenants++;
    const ids = rows.map(r => r.id as string);
    const claimed = await tdb(tenantId).from("wa_review_alerts").update({ emailed_at: new Date(now).toISOString() })
      .in("id", ids).is("emailed_at", null).select("id");
    const mine = new Set(((claimed.data ?? []) as unknown as { id: string }[]).map(r => r.id));
    const batch = rows.filter(r => mine.has(r.id as string));
    if (!batch.length) continue;

    const settings = await getReviewSettings(tenantId);
    const skip = async (why: string) => { await tdb(tenantId).from("wa_review_alerts").update({ email_error: why }).in("id", [...mine]); };
    if (!settings.alerts.email) { await skip("Email alerts are off"); continue; }
    if (!emailConfigured()) { await skip("Email isn't set up on this deployment"); continue; }
    const optedOut = await unsubscribedRecipients(tenantId, "review_alerts");
    const to = (await alertRecipients(tenantId, settings.alerts.recipients)).filter(e => !optedOut.has(e));
    if (!to.length) { await skip("No one to email"); continue; }

    const brand = await brandForTenant(tenantId);
    const first = batch[0];
    const subject = batch.length === 1 ? String(first.title) : `${batch.length} review updates need a look`;
    let failed = 0;
    for (const addr of to) {
      const unsub = unsubscribeUrl(tenantId, "review_alerts", addr);
      const mail = applyEmailBrand(brand, {
        preheader: batch.length === 1 ? String(first.body || first.title).slice(0, 110) : batch.map(b => b.title).join(" · ").slice(0, 110),
        heading: batch.length === 1 ? "A review needs your attention" : "Reviews that need your attention",
        paragraphs: batch.slice(0, 10).map(b => `${b.title}${b.body ? ` — ${b.body}` : ""}`).concat(batch.length > 10 ? [`…and ${batch.length - 10} more in the Reviews tab.`] : []),
        cta: { label: batch.length === 1 && first.review_id ? "Open the review" : "Open Reviews", href: batch.length === 1 ? alertHref({ reviewId: first.review_id as string | null }) : "/admin?tab=reviews" },
        footerReason: "You're getting this because review alerts are on for your workspace. Change who gets them in Reviews → Settings.",
        unsubscribeHref: unsub,
      }, SITE_URL, subject);
      const { html, text } = renderEmail(mail.opts, mail.siteUrl);
      const r = await sendEmail({ to: addr, subject: mail.subject, html, text, unsubscribeUrl: mail.opts.unsubscribeHref ?? unsub, type: "review_alert", tenantId, ...(mail.fromName ? { fromName: mail.fromName, fromEmail: mail.fromEmail } : {}) })
        .catch(e => ({ ok: false, error: e instanceof Error ? e.message : "send failed" }));
      if (r.ok) emails++; else failed++;
    }
    if (failed) await skip(`${failed} of ${to.length} emails couldn't be sent`);
  }
  return { tenants, emails };
}

/**
 * Reviews still without a public reply past the workspace's limit raise one
 * "overdue" alert each. Only reviews from the last two weeks, so connecting a
 * profile with years of history doesn't ring for every old review.
 */
export async function sweepOverdueReviews(now = Date.now(), max = 200): Promise<number> {
  const { data, error } = await db().from("wa_reviews")
    .select("id,tenant_id,author,rating,review_created_at,source").neq("reply_status", "posted")
    .lt("review_created_at", new Date(now - 3_600_000).toISOString())
    .gte("review_created_at", new Date(now - 14 * 86_400_000).toISOString())
    .order("review_created_at", { ascending: true }).limit(max);
  if (error || !data?.length) return 0;
  const hoursFor = new Map<string, number>();
  let raised = 0;
  for (const r of data as unknown as { id: string; tenant_id: string; author: string; rating: number; review_created_at: string; source: string }[]) {
    if (!hoursFor.has(r.tenant_id)) hoursFor.set(r.tenant_id, (await getReviewSettings(r.tenant_id)).alerts.unansweredHours);
    const hours = hoursFor.get(r.tenant_id)!;
    if (now - Date.parse(r.review_created_at) < hours * 3_600_000) continue;
    if (await raiseAlert(r.tenant_id, {
      kind: "overdue", dedupeKey: `review:${r.id}:overdue`, reviewId: r.id,
      title: `${r.author || "A customer"}'s ${r.rating ? `${r.rating}★ ` : ""}review has had no reply for over ${hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`}`,
    })) raised++;
  }
  return raised;
}
