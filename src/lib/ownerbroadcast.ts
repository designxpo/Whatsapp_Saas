// Platform → tenant email campaigns ("email all tenants"). The owner composes
// once; every matching tenant's owner email is frozen into a queue at create
// time and drained by the cron in paced chunks.
//
// Why a queue and not a loop over tenants inside the request: Resend rate-limits
// (a tight loop trips it and silently drops the tail), a serverless function
// times out long before a few hundred sequential sends finish, and a half-sent
// campaign with no record of who already got it is unrecoverable. The queue
// makes it resumable, idempotent per recipient, and safe to interrupt.
//
// Sends go through sendEmail(), so every recipient lands in wa_email_log (0114)
// and picks up delivered/opened/clicked/bounced from the Resend webhook for
// free — the campaign's delivery report is a filter on the log, not a second
// tracking table.

import { db } from "./supabase";
import { sendEmail } from "./email";
import { renderEmail } from "./emailtemplate";
import { SITE_URL } from "./siteurl";

export type AudienceMode = "all" | "active" | "trialing" | "suspended";
export const AUDIENCE_MODES: AudienceMode[] = ["all", "active", "trialing", "suspended"];

export const AUDIENCE_LABEL: Record<AudienceMode, string> = {
  all: "All tenants",
  active: "Paying tenants",
  trialing: "Tenants on trial",
  suspended: "Suspended / past-due tenants",
};

export type CampaignMode = "simple" | "html";
export type CampaignStatus = "draft" | "sending" | "sent" | "partial" | "failed" | "cancelled";

export interface OwnerCampaign {
  id: string; subject: string; mode: CampaignMode;
  heading: string | null; bodyParagraphs: string[]; imageUrl: string | null;
  ctaLabel: string | null; ctaUrl: string | null; htmlBody: string | null;
  audienceMode: AudienceMode; status: CampaignStatus;
  totalRecipients: number; sentCount: number; failedCount: number;
  errorSummary: string | null; createdBy: string | null;
  createdAt: string; sentAt: string | null;
}

export interface CampaignInput {
  subject: string; mode: CampaignMode;
  heading?: string; paragraphs?: string[]; imageUrl?: string | null;
  ctaLabel?: string | null; ctaUrl?: string | null; htmlBody?: string;
  audienceMode: AudienceMode;
  createdBy?: string | null;
}

function mapCampaign(r: Record<string, unknown>): OwnerCampaign {
  return {
    id: r.id as string,
    subject: r.subject as string,
    mode: (r.mode as CampaignMode) ?? "simple",
    heading: (r.heading as string | null) ?? null,
    bodyParagraphs: (r.body_paragraphs as string[] | null) ?? [],
    imageUrl: (r.image_url as string | null) ?? null,
    ctaLabel: (r.cta_label as string | null) ?? null,
    ctaUrl: (r.cta_url as string | null) ?? null,
    htmlBody: (r.html_body as string | null) ?? null,
    audienceMode: (((r.audience as { mode?: string } | null)?.mode) as AudienceMode) ?? "all",
    status: (r.status as CampaignStatus) ?? "draft",
    totalRecipients: Number(r.total_recipients ?? 0),
    sentCount: Number(r.sent_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    errorSummary: (r.error_summary as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string | null) ?? null,
  };
}

export interface Recipient { tenantId: string; email: string; company: string | null; ownerName: string | null }

// Who a segment resolves to, RIGHT NOW. Called once at create time and frozen
// into the queue — a tenant who signs up (or lapses) mid-send must not silently
// join or leave a campaign whose copy was already reviewed and approved.
export async function resolveAudience(mode: AudienceMode): Promise<Recipient[]> {
  let q = db().from("tenants").select("id, owner_email, company, owner_name, status, payment_status").not("owner_email", "is", null);
  if (mode === "active") q = q.eq("payment_status", "active");
  else if (mode === "trialing") q = q.or("status.eq.trialing,payment_status.eq.trialing");
  else if (mode === "suspended") q = q.or("status.eq.suspended,status.eq.cancelled,payment_status.eq.past_due");
  const { data, error } = await q;
  if (error) throw error;

  // Two tenants can share an owner email (an agency running several
  // workspaces). One email per address — the DB's unique constraint would
  // reject the duplicate anyway; de-duping here keeps total_recipients honest.
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of data ?? []) {
    const email = ((r.owner_email as string) ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      tenantId: r.id as string, email,
      company: (r.company as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
    });
  }
  return out;
}

/** Recipient count for a segment, for the composer's "this will go to N" line. */
export async function audienceCount(mode: AudienceMode): Promise<number> {
  return (await resolveAudience(mode)).length;
}

// Creates the campaign and its frozen recipient queue in one go. Status starts
// 'draft' — nothing sends until startCampaign() flips it, so a create that
// half-fails can never leak a partial blast.
export async function createCampaign(input: CampaignInput): Promise<OwnerCampaign> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("A subject is required");
  const paragraphs = (input.paragraphs ?? []).map(p => p.trim()).filter(Boolean);

  if (input.mode === "simple") {
    if (!input.heading?.trim()) throw new Error("A heading is required in simple mode");
    if (!paragraphs.length) throw new Error("Add at least one paragraph of body copy");
  } else if (!input.htmlBody?.trim()) {
    throw new Error("Custom HTML mode needs an HTML body");
  }
  // A CTA is all-or-nothing: a labelled button with no URL renders as a dead
  // control in every recipient's inbox.
  if ((input.ctaLabel?.trim() && !input.ctaUrl?.trim()) || (input.ctaUrl?.trim() && !input.ctaLabel?.trim())) {
    throw new Error("A call-to-action needs both a label and a URL");
  }

  const recipients = await resolveAudience(input.audienceMode);
  if (!recipients.length) throw new Error(`No tenants match "${AUDIENCE_LABEL[input.audienceMode]}" — nothing to send to`);

  const { data, error } = await db().from("wa_owner_email_campaigns").insert({
    subject,
    mode: input.mode,
    heading: input.heading?.trim() || null,
    body_paragraphs: paragraphs,
    image_url: input.imageUrl?.trim() || null,
    cta_label: input.ctaLabel?.trim() || null,
    cta_url: input.ctaUrl?.trim() || null,
    html_body: input.mode === "html" ? input.htmlBody : null,
    audience: { mode: input.audienceMode },
    status: "draft",
    total_recipients: recipients.length,
    created_by: input.createdBy ?? null,
  }).select("*").single();
  if (error) throw error;
  const campaign = mapCampaign(data as Record<string, unknown>);

  const rows = recipients.map(r => ({
    campaign_id: campaign.id, tenant_id: r.tenantId, to_email: r.email,
    company: r.company, owner_name: r.ownerName, status: "pending",
  }));
  // ignoreDuplicates: the unique (campaign_id,to_email) constraint is the real
  // guarantee; this just stops a retry of the same create from erroring.
  const { error: qErr } = await db().from("wa_owner_email_queue").upsert(rows, { onConflict: "campaign_id,to_email", ignoreDuplicates: true });
  if (qErr) throw qErr;

  return campaign;
}

/** Draft → sending. Idempotent: re-arming an already-sending campaign is a no-op. */
export async function startCampaign(id: string): Promise<boolean> {
  const { data } = await db().from("wa_owner_email_campaigns")
    .update({ status: "sending" }).eq("id", id).eq("status", "draft").select("id");
  return !!data?.length;
}

/** Stops a campaign mid-flight. Already-sent emails are gone — this only
 *  prevents the remaining queue from going out. */
export async function cancelCampaign(id: string): Promise<boolean> {
  const { data } = await db().from("wa_owner_email_campaigns")
    .update({ status: "cancelled", error_summary: "Cancelled by the owner" })
    .eq("id", id).in("status", ["draft", "sending"]).select("id");
  if (data?.length) {
    await db().from("wa_owner_email_queue").update({ status: "skipped", error: "Campaign cancelled", processed_at: new Date().toISOString() })
      .eq("campaign_id", id).eq("status", "pending");
  }
  return !!data?.length;
}

export async function listCampaigns(limit = 30): Promise<OwnerCampaign[]> {
  const { data, error } = await db().from("wa_owner_email_campaigns")
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

export async function getCampaign(id: string): Promise<OwnerCampaign | null> {
  const { data } = await db().from("wa_owner_email_campaigns").select("*").eq("id", id).maybeSingle();
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

// ── Rendering ────────────────────────────────────────────────────────────────
// {{company}} / {{name}} substitution, applied to the subject and body of each
// recipient's copy. Deliberately tiny: two tokens, no expression language, and
// an unknown token is left alone rather than blanked, so a typo shows up in a
// test send instead of silently deleting text.
function personalise(s: string, r: { company: string | null; ownerName: string | null }): string {
  return s
    .replace(/\{\{\s*company\s*\}\}/gi, r.company || "your business")
    .replace(/\{\{\s*name\s*\}\}/gi, r.ownerName || "there");
}

export function renderCampaign(c: OwnerCampaign, r: { company: string | null; ownerName: string | null }): { subject: string; html: string; text: string } {
  const subject = personalise(c.subject, r);
  if (c.mode === "html") {
    const html = personalise(c.htmlBody ?? "", r);
    // No HTML→text conversion beyond stripping tags: a hand-built campaign's
    // text alternative is better as readable prose than as mangled markup.
    const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { subject, html, text };
  }
  const { html, text } = renderEmail({
    preheader: personalise(c.bodyParagraphs[0] ?? c.subject, r).slice(0, 140),
    heading: personalise(c.heading ?? c.subject, r),
    paragraphs: c.bodyParagraphs.map(p => personalise(p, r)),
    ...(c.imageUrl ? { imageUrl: c.imageUrl, imageAlt: personalise(c.heading ?? "", r) } : {}),
    ...(c.ctaLabel && c.ctaUrl ? { cta: { label: c.ctaLabel, href: c.ctaUrl } } : {}),
    footerReason: "You're getting this because you own a Talko AI workspace. It's an occasional product announcement from the team, not a recurring newsletter.",
  }, SITE_URL);
  return { subject, html, text };
}

// ── Drain (called from the cron) ─────────────────────────────────────────────

// Resend's API is rate-limited (2 requests/second on the default plan), so sends
// are paced rather than fired in a tight loop — a burst gets 429s and silently
// drops the tail of a campaign. 600ms keeps a comfortable margin under it.
const SEND_GAP_MS = 600;
// Per tick, across ALL campaigns. The cron's whole budget is ~45s shared with a
// dozen other jobs, and 25 × 600ms ≈ 15s already claims a third of it. A larger
// campaign simply finishes over several ticks — the queue is built for that.
const PER_TICK = 25;

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

export async function drainOwnerEmailCampaigns(max = PER_TICK): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };

  const { data: sending } = await db().from("wa_owner_email_campaigns")
    .select("*").eq("status", "sending").order("created_at", { ascending: true });
  if (!sending?.length) return out;

  let budget = Math.max(0, max);
  for (const row of sending) {
    if (budget <= 0) break;
    const campaign = mapCampaign(row as Record<string, unknown>);

    const { data: claimed, error: claimErr } = await db().rpc("claim_owner_email_queue", { p_campaign: campaign.id, p_limit: budget });
    if (claimErr) {
      // No atomic claim available means the migration hasn't been applied. Send
      // NOTHING rather than fall back to an unclaimed read: a stalled campaign
      // is recoverable, a duplicated blast to every tenant is not (0044's
      // comment records what that cost the internal build).
      console.error("[ownerbroadcast] no atomic claim available — apply migration 0115", claimErr.message);
      return out;
    }
    const rows = (claimed ?? []) as { id: string; tenant_id: string | null; to_email: string; company: string | null; owner_name: string | null }[];

    if (!rows.length) {
      // Queue drained → settle the campaign's final status from its counters.
      const status = campaign.failedCount > 0 ? (campaign.sentCount > 0 ? "partial" : "failed") : "sent";
      await db().from("wa_owner_email_campaigns")
        .update({ status, sent_at: campaign.sentAt ?? new Date().toISOString() })
        .eq("id", campaign.id).eq("status", "sending");
      continue;
    }

    for (const r of rows) {
      if (budget <= 0) break;
      budget--;
      const { subject, html, text } = renderCampaign(campaign, { company: r.company, ownerName: r.owner_name });
      const result = await sendEmail({
        to: r.to_email, subject, html, text,
        type: "owner_broadcast", tenantId: r.tenant_id, campaignId: campaign.id,
      });
      await db().from("wa_owner_email_queue").update({
        status: result.ok ? "sent" : "failed",
        error: result.ok ? null : (result.error ?? "send failed"),
        processed_at: new Date().toISOString(),
      }).eq("id", r.id);
      if (result.ok) out.sent++; else out.failed++;
      await sleep(SEND_GAP_MS);
    }

    // Recount from the queue rather than incrementing — concurrent ticks would
    // race a read-modify-write, and the queue is the source of truth anyway.
    const [{ count: sentN }, { count: failedN }] = await Promise.all([
      db().from("wa_owner_email_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "sent"),
      db().from("wa_owner_email_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "failed"),
    ]);
    await db().from("wa_owner_email_campaigns")
      .update({ sent_count: sentN ?? 0, failed_count: failedN ?? 0 })
      .eq("id", campaign.id);
  }

  return out;
}
