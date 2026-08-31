import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
// Submitter-controlled text is interpolated into an HTML email body — escaping
// it stops a message injecting markup into the email the support inbox opens.
import { escapeHtml } from "@/lib/emailtemplate";

export const dynamic = "force-dynamic";

const SUPPORT_INBOX = "info@thetalko.in";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST — PUBLIC (no auth). The /contact page's form. `website` is a honeypot,
// same convention as /api/waitlist: real visitors never fill it, bots do — we
// accept the request (so the bot sees success) but send nothing.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ success: true });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const topic = typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : "General";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!name || !EMAIL_RE.test(email) || !message) {
    return NextResponse.json({ error: "Please fill in your name, a valid email, and a message." }, { status: 400 });
  }

  const result = await sendEmail({
    to: SUPPORT_INBOX,
    replyTo: email,
    subject: `[Contact — ${topic}] ${name}`,
    html: `
      <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
      <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>
    `,
    type: "contact_form",
  });
  if (!result.ok) return NextResponse.json({ error: "Couldn't send your message — please email us directly instead." }, { status: 502 });
  return NextResponse.json({ success: true });
}
