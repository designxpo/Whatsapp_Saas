import { NextResponse } from "next/server";
import { verifyResendSignature } from "@/lib/apiauth";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Resend's delivery-lifecycle webhook — the other half of the Emails panel.
// sendEmail() logs a row the moment it hands an email to Resend (status
// "sent"); this is how that row later learns it was actually delivered,
// opened, clicked, or bounced. Configure in the Resend dashboard → Webhooks:
// endpoint https://<domain>/api/webhooks/resend, events: sent, delivered,
// delivery_delayed, opened, clicked, bounced, complained, failed. The signing
// secret Resend shows you goes in RESEND_WEBHOOK_SECRET.
//
// Resend's webhooks ARE Svix under the hood (svix-id / svix-timestamp /
// svix-signature headers) — verifyResendSignature implements that by hand.

// Only the events wa_email_log's `status` check-constraint knows about get
// applied to a row; anything else (e.g. delivery_delayed → 'delayed', which
// the constraint does track) still needs its own mapping here.
const STATUS_FOR_TYPE: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

// Which timestamp column each status also stamps, so the panel can show WHEN
// something happened, not just its current status — later events (e.g. a
// click after an open) update status forward but never blank out an earlier
// timestamp that already landed.
const TIMESTAMP_COL: Record<string, string> = {
  delivered: "delivered_at", opened: "opened_at", clicked: "clicked_at", bounced: "bounced_at",
};

// Webhook delivery order isn't guaranteed — "opened" can arrive before
// "delivered" lands. Rank keeps the displayed status moving forward only,
// EXCEPT a terminal failure (bounced/complained/failed) always wins: bad news
// that arrives late is still news, and must never be masked by an earlier
// "delivered" that already wrote a higher-looking rank.
const RANK: Record<string, number> = { sent: 1, delayed: 1, delivered: 2, opened: 3, clicked: 4, bounced: 9, complained: 9, failed: 9 };

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyResendSignature(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  }, process.env.RESEND_WEBHOOK_SECRET);
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: { type?: string; data?: { email_id?: string } };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const status = body.type ? STATUS_FOR_TYPE[body.type] : undefined;
  const emailId = body.data?.email_id;
  // Unrecognized event types (domain.*, contact.*, email.scheduled, …) and a
  // missing email_id (shouldn't happen, but never worth a 500 over) both just
  // no-op — Resend only cares that we returned 200, not that we acted.
  if (!status || !emailId) return NextResponse.json({ received: true });

  try {
    // "sent" is set at insert time and never needs re-writing; skip the no-op
    // update so a redelivered email.sent event doesn't touch the row at all.
    if (status === "sent") return NextResponse.json({ received: true });

    const { data: row } = await db().from("wa_email_log").select("status").eq("resend_id", emailId).maybeSingle();
    if (!row) return NextResponse.json({ received: true });   // unknown email_id — nothing to update

    const patch: Record<string, unknown> = {};
    const col = TIMESTAMP_COL[status];
    if (col) patch[col] = new Date().toISOString();
    if ((RANK[status] ?? 0) >= (RANK[row.status as string] ?? 0)) patch.status = status;
    if (Object.keys(patch).length) await db().from("wa_email_log").update(patch).eq("resend_id", emailId);
  } catch (e) {
    // Never fail the webhook over our own logging — Resend will retry a
    // non-200, and retrying doesn't fix a DB problem, it just spams retries.
    console.error("[resend webhook] failed to update wa_email_log:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ received: true });
}
