// Daily digest email — one a business morning to a workspace's admins and owner.
//
// The weekly recap (weeklyrecap.ts) says how the week went. This says what is
// waiting: chats owed a reply and which number they sit on, escalations nobody
// picked up, and yesterday's leads, AI replies, opt-outs and failed sends —
// with the workspace's own AI read on top when it has a key.
//
// Same conventions as the weekly recap, deliberately:
//
//   • One send per (workspace, business day) via claimTenantSettingOnce, the
//     key embedding the day, so it "resets" daily with no cleanup job. The
//     claim is released when nothing was delivered, so a later tick retries.
//   • An unsubscribe link (emailprefs.ts), honoured before the claim.
//
// And two decisions of its own:
//
//   • OFF until a workspace admin switches it on — it emails their team, so it
//     is their call. Switching it on clears an earlier unsubscribe.
//   • The day is the BUSINESS day (businessclock.ts): Vercel runs on UTC, and
//     "send at 9" must mean 9 where the business is.

import { applyEmailBrand } from "./email-brand";
import { brandForTenant } from "./brand-lookup";
import { TALKO_BRAND, type Brand } from "./whitelabel";
import { db } from "./supabase";
import {
  getTenantSetting, setTenantSetting, tenantIdsWithSetting,
  claimTenantSettingOnce, releaseTenantSetting,
} from "./store";
import { listUsers } from "./team";
import { sendEmail } from "./email";
import { renderEmail, type EmailStat } from "./emailtemplate";
import { isUnsubscribed, setUnsubscribed, unsubscribeUrl } from "./emailprefs";
import { generateExecutiveBrief } from "./llm";
import { partsIn, BUSINESS_TZ } from "./businessclock";
import { SITE_URL } from "./siteurl";
import { gatherDigest, type DigestNumbers } from "./digestdata";

export interface DigestConfig { enabled: boolean; hour: number }

const CONFIG_KEY = "daily_digest";
export const LAST_DAY_KEY = "daily_digest_last_day";
const DEFAULT_HOUR = 9;
// Bounded per tick like the escalation sweep: the cron's deadline is shared.
const MAX_TENANTS_PER_TICK = 25;

const businessDay = (at: number): string => {
  const w = partsIn(new Date(at));
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};

export async function getDigestConfig(tenantId: string): Promise<DigestConfig> {
  const raw = await getTenantSetting<Partial<DigestConfig>>(tenantId, CONFIG_KEY, {});
  const hour = Number(raw?.hour);
  return {
    enabled: raw?.enabled === true,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR,
  };
}

export async function setDigestConfig(tenantId: string, patch: Partial<DigestConfig>): Promise<DigestConfig> {
  const cur = await getDigestConfig(tenantId);
  const hour = patch.hour === undefined ? cur.hour : Number(patch.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("Hour must be a whole number from 0 to 23.");
  const next = { enabled: patch.enabled ?? cur.enabled, hour };
  await setTenantSetting(tenantId, CONFIG_KEY, next);
  // An admin switching it on is a newer decision than someone's unsubscribe.
  if (patch.enabled === true) await setUnsubscribed(tenantId, "daily_digest", false);
  return next;
}

/** Due once the business-day hour has passed. Once-a-day is the claim's job. */
export function digestDue(cfg: DigestConfig, now: number): boolean {
  return cfg.enabled && partsIn(new Date(now)).hour >= cfg.hour;
}

/** The workspace's active admins, plus its owner. */
export async function digestRecipients(tenantId: string, ownerEmail?: string | null): Promise<string[]> {
  const admins = (await listUsers(tenantId))
    .filter(u => u.active && u.role === "admin" && /@/.test(u.email ?? ""))
    .map(u => u.email);
  return [...new Set([...admins, ...(ownerEmail ? [ownerEmail] : [])].map(e => e.trim().toLowerCase()).filter(Boolean))];
}

const age = (h: number) => (h < 48 ? `${h}h` : `${Math.round(h / 24)} days`);

function factLines(n: DigestNumbers): string[] {
  return [
    `${n.waiting.total} chats waiting on a reply${n.waiting.oldestHours != null ? ` — the oldest for ${age(n.waiting.oldestHours)}` : ""}`,
    ...n.waiting.byOwner.map(o => `  ${o.name}: ${o.count}`),
    `${n.escalatedStale} escalated more than a day ago and still escalated`,
    `Yesterday (${n.day}): ${n.yesterday.newLeads} new leads, ${n.yesterday.aiReplies} AI replies, ${n.yesterday.escalations} escalations, ${n.yesterday.optOuts} opt-outs, ${n.yesterday.failedSends} failed sends`,
    `${n.inDrips} people in drips right now`,
  ];
}

export function renderDigest(n: DigestNumbers, tenantId: string, ai?: { headline: string; steps: { action: string; why: string }[] } | null, brand: Brand = TALKO_BRAND): { subject: string; html: string; text: string; unsub: string; fromName?: string } {
  const subject = `Today: ${n.waiting.total} waiting on a reply, ${n.yesterday.newLeads} new leads yesterday`;
  const stats: EmailStat[] = [
    { value: String(n.waiting.total), label: "waiting on a reply", delta: n.waiting.oldestHours != null ? `oldest ${age(n.waiting.oldestHours)}` : undefined },
    { value: String(n.escalatedStale), label: "escalated over a day ago" },
    { value: String(n.yesterday.newLeads), label: "new leads yesterday" },
  ];
  const paragraphs = [
    n.waiting.byOwner.length ? `Waiting, by number: ${n.waiting.byOwner.map(o => `${o.name} ${o.count}`).join(" · ")}.` : "Nothing is waiting on a reply.",
    `Yesterday: ${n.yesterday.aiReplies} AI replies, ${n.yesterday.escalations} escalations, ${n.yesterday.optOuts} opt-outs, ${n.yesterday.failedSends} failed sends. ${n.inDrips} people are in drips right now.`,
  ];
  const unsub = unsubscribeUrl(tenantId, "daily_digest");
  // White-label: a partner's customer gets this in the partner's brand.
  const mail = applyEmailBrand(brand, {
    preheader: `${n.day} · what is waiting on your team this morning.`,
    heading: "Your morning digest",
    paragraphs,
    stats,
    ...(ai ? { highlight: ai.headline, steps: ai.steps.map(s => `${s.action} — ${s.why}`) } : {}),
    cta: { label: "Open your inbox", href: "/login" },
    footerReason: "You're getting this because an admin switched on the daily digest for your workspace. Once a day, never more.",
    unsubscribeHref: unsub,
  }, SITE_URL, subject);
  const { html, text } = renderEmail(mail.opts, mail.siteUrl);
  return { subject: mail.subject, html, text, unsub: mail.opts.unsubscribeHref ?? unsub, ...(mail.fromName ? { fromName: mail.fromName } : {}) };
}

async function sendTo(tenantId: string, to: string[], now: number): Promise<number> {
  const numbers = await gatherDigest(tenantId, now);
  // The workspace's own key (BYO). No key, a busy model or a bad answer just
  // leaves the AI read out — the counts are the point.
  const ai = await generateExecutiveBrief(factLines(numbers).join("\n"), tenantId)
    .then(b => ({ headline: b.headline, steps: b.steps.slice(0, 3) }))
    .catch(() => null);
  const mail = renderDigest(numbers, tenantId, ai, await brandForTenant(tenantId));
  let sent = 0;
  for (const addr of to) {
    const r = await sendEmail({ to: addr, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsub, type: "daily_digest", tenantId, ...(mail.fromName ? { fromName: mail.fromName } : {}) })
      .catch(() => ({ ok: false }));
    if (r.ok) sent++;
  }
  return sent;
}

export async function drainDailyDigests(now = Date.now()): Promise<{ tenants: number; sent: number }> {
  const enabled = await tenantIdsWithSetting(CONFIG_KEY, v => (v as { enabled?: unknown } | null)?.enabled === true);
  if (!enabled.length) return { tenants: 0, sent: 0 };
  const { data: tenants } = await db().from("tenants").select("id, owner_email").in("id", enabled).in("status", ["trialing", "active"]);
  const day = businessDay(now);
  let done = 0, sent = 0;
  for (const t of (tenants ?? []).slice(0, MAX_TENANTS_PER_TICK)) {
    const tenantId = (t as { id: string }).id;
    try {
      if (!digestDue(await getDigestConfig(tenantId), now)) continue;
      if (await isUnsubscribed(tenantId, "daily_digest")) continue;
      const to = await digestRecipients(tenantId, (t as { owner_email?: string | null }).owner_email);
      if (!to.length) continue;
      const key = `${CONFIG_KEY}:${day}`;
      if (!(await claimTenantSettingOnce(tenantId, key))) continue;   // already sent (or in flight) today
      const n = await sendTo(tenantId, to, now);
      if (n === 0) await releaseTenantSetting(tenantId, key).catch(() => undefined);
      else {
        done++; sent += n;
        // For the settings card's "last sent" line; the claim key is the guard.
        await setTenantSetting(tenantId, LAST_DAY_KEY, day).catch(() => undefined);
      }
    } catch (e) {
      console.error("[dailydigest]", tenantId, e);
    }
  }
  return { tenants: done, sent };
}

/** The "Send a test now" button: sends immediately and does not use up the day. */
export async function sendDigestNow(tenantId: string, now = Date.now()): Promise<{ sent: number; reason?: string }> {
  const { data } = await db().from("tenants").select("id, owner_email").in("id", [tenantId]);
  const owner = (data?.[0] as { owner_email?: string | null } | undefined)?.owner_email ?? null;
  const to = await digestRecipients(tenantId, owner);
  if (!to.length) return { sent: 0, reason: "No admin in this workspace has an email address." };
  const sent = await sendTo(tenantId, to, now);
  return { sent, ...(sent < to.length ? { reason: `${to.length - sent} of ${to.length} could not be sent.` } : {}) };
}

export const DIGEST_TZ = BUSINESS_TZ;
