// Thin Resend wrapper for transactional email (currently: OTP codes only).
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

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<SendEmailResult> {
  try {
    const from = process.env.RESEND_FROM_EMAIL || "Talko AI <no-reply@thetalko.in>";
    const r = await resend().emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html });
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed" };
  }
}
