// Thin Resend wrapper for outbound email (OTP codes, lifecycle email).
// Fail-closed: a missing API key throws rather than silently no-op-ing, so an
// auth flow can never appear to "send a code" that never left the server.

import { Resend } from "resend";

let client: Resend | null = null;

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
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed" };
  }
}
