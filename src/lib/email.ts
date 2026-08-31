// Thin Resend wrapper for outbound email (OTP codes, lifecycle email).
// Fail-closed: a missing API key throws rather than silently no-op-ing, so an
// auth flow can never appear to "send a code" that never left the server.

import { Resend } from "resend";
import { db } from "./supabase";

let client: Resend | null = null;

// Every category of email this app sends. Kept here (not derived) so the
// Emails panel's filter list and every call site's `type` argument both stay
// honest about the full set — a call site passing a typo'd string just gets
// TypeScript red, not a silently uncategorized "other" row discovered later.
export type EmailType =
  | "otp" | "invoice" | "dunning_failed" | "dunning_suspended"
  | "weekly_recap" | "onboarding_nudge" | "affiliate_commission" | "contact_form"
  | "owner_broadcast" | "platform_alert" | "other";

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured — cannot send email");
  if (!client) client = new Resend(key);
  return client;
}

export interface SendEmailResult { ok: boolean; error?: string }

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /**
   * Plain-text alternative. Supply it for anything bulk: an HTML-only message
   * scores worse with spam filters, and some clients (and every screen reader
   * in plain-text mode) show this instead of the HTML.
   */
  text?: string;
  /**
   * Unsubscribe URL for recurring mail. Adds List-Unsubscribe and
   * List-Unsubscribe-Post, which is what makes the native "Unsubscribe" button
   * appear next to the sender in Gmail — and what Gmail and Yahoo's bulk-sender
   * rules expect from anyone sending at volume. A mailto: URL is accepted and
   * gets the header without the one-click POST directive, which only applies to
   * https endpoints.
   */
  unsubscribeUrl?: string;
  /**
   * What this email is, for the Owner Console's Emails panel. Optional so a
   * call site can't fail to compile over a logging detail, but every real
   * caller should pass one — an omitted type logs as "other" and is
   * indistinguishable from every other uncategorized send in the panel.
   */
  type?: EmailType;
  /** Whose workspace this concerns, when there is one (absent for the
   * contact form and other platform-level sends). */
  tenantId?: string | null;
  /** Set by an owner broadcast, so the Emails log doubles as that campaign's
   * per-recipient delivery report. */
  campaignId?: string | null;
}

// Best-effort row in wa_email_log — logging failing must never make a
// successful send LOOK failed to the caller, so every error here is
// swallowed after a console.error. Returns the row id (for the webhook to
// find later) or null if logging itself didn't work.
async function logSend(opts: SendEmailOptions, resendId: string | null, status: "sent" | "failed", error?: string): Promise<string | null> {
  try {
    const { data } = await db().from("wa_email_log").insert({
      tenant_id: opts.tenantId ?? null,
      campaign_id: opts.campaignId ?? null,
      email_type: opts.type ?? "other",
      to_email: opts.to,
      subject: opts.subject,
      resend_id: resendId,
      status,
      error: error ?? null,
    }).select("id").single();
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error("[email] failed to log send (email itself was unaffected):", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const from = process.env.RESEND_FROM_EMAIL || "Talko AI <no-reply@thetalko.in>";
    const headers: Record<string, string> = {};
    if (opts.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
      // One-click only means anything for an HTTPS endpoint that accepts POST;
      // advertising it for a mailto: would make compliant clients POST nowhere.
      if (/^https:/i.test(opts.unsubscribeUrl)) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const r = await resend().emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    if (r.error) {
      await logSend(opts, null, "failed", r.error.message);
      return { ok: false, error: r.error.message };
    }
    // Fire-and-forget: the log row is for the Emails panel, not something a
    // caller should ever wait on or fail over.
    void logSend(opts, r.data?.id ?? null, "sent");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Email send failed";
    await logSend(opts, null, "failed", msg);
    return { ok: false, error: msg };
  }
}
