import { applyLsqLead } from "@/lib/lsqapply";
export const maxDuration = 30;
import { NextResponse } from "next/server";
import { constEq } from "@/lib/apiauth";
import { parseLsqWebhook } from "@/lib/lsqwebhook";
import { upsertContacts, setContactAttributes, getContactByPhoneLoose, getConversationByPhone, assignConversation, getTenantSecret, optoutSet, armFlow } from "@/lib/store";
import { getStageDrips, stageTransition } from "@/lib/stagedrips";
import { getLeadWelcome, shouldWelcome, toWaNumber } from "@/lib/leadwelcome";
import { enroll, stopEnrollment } from "@/lib/sequences";
import { sendTemplateSingle } from "@/lib/whatsapp";
import { getDefaultChannel } from "@/lib/channels";
import { listUsers } from "@/lib/team";

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

export const dynamic = "force-dynamic";

// LeadSquared → portal webhook (Phase 4 of the counselor workflow), tenant-
// scoped: the URL carries ?t=<tenantId> and the secret is per-tenant (minted in
// Integrations → LeadSquared → Inbound webhook; stored in wa_settings under
// lsq_webhook_secret). One event, driven by whichever fields are present:
//   • upserts the contact (lead exists in the portal BEFORE any message)
//   • stores lsq_lead_id / lsq_stage / lsq_owner / lsq_source attributes
//   • owner email matching a team member → the lead's WhatsApp conversation is
//     auto-assigned to that counselor (visible in Live Chat)
// Always answers 200 for handled-but-skipped payloads so LSQ's automation
// report doesn't fill with retries for non-actionable events.

// wa_settings key for the per-tenant inbound secret — keep in sync with
// /api/admin/lsq-webhook (route files can't export extra constants).
const LSQ_WEBHOOK_SECRET_KEY = "lsq_webhook_secret";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const tid = (url.searchParams.get("t") ?? "").trim();
  if (!UUID_RE.test(tid)) return NextResponse.json({ error: "Missing/invalid ?t=<workspace id>" }, { status: 400 });

  const secret = (await getTenantSecret(tid, LSQ_WEBHOOK_SECRET_KEY).catch(() => null)) ?? "";
  if (!secret) return NextResponse.json({ error: "Inbound webhook not configured for this workspace (mint a secret in Integrations → LeadSquared)" }, { status: 503 });
  const given = req.headers.get("x-lsq-secret") ?? url.searchParams.get("secret") ?? "";
  if (!constEq(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const ev = parseLsqWebhook(body);

  const result = await applyLsqLead(ev, {}, tid);
  return NextResponse.json({ ...result, event: ev.event });
}
