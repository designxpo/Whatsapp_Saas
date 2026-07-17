export const maxDuration = 30;
import { NextResponse } from "next/server";
import { constEq } from "@/lib/apiauth";
import { parseLsqWebhook } from "@/lib/lsqwebhook";
import { upsertContacts, setContactAttributes, getContactByPhoneLoose, getConversationByPhone, assignConversation, getTenantSecret, optoutSet } from "@/lib/store";
import { getStageDrips, stageTransition } from "@/lib/stagedrips";
import { enroll, stopEnrollment } from "@/lib/sequences";
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

  if (!ev.phone) return NextResponse.json({ handled: false, reason: "no usable phone in payload", event: ev.event });

  // 1) Ensure the contact exists (no-op update if it already does — existing
  //    attributes win inside upsert, fresh LSQ values are applied in step 2).
  await upsertContacts(
    [{ phone: ev.phone, name: ev.name ?? undefined, email: ev.email ?? undefined }],
    "leadsquared", tid,
  ).catch(() => undefined);

  // LSQ often stores 10-digit numbers while WhatsApp is always country-coded
  // (919…) — resolve the CANONICAL stored contact (suffix-aware) so the
  // attribute stamp and conversation lookup below hit, not miss. Its CURRENT
  // lsq_stage (pre-stamp) is the "previous stage" for the drip transition.
  const existing = await getContactByPhoneLoose(ev.phone, tid).catch(() => null);
  const canonical = existing?.phone ?? ev.phone;
  const prevStage = existing?.attributes?.lsq_stage;

  // 2) Stamp the LSQ picture (incoming wins — stage/owner changes must stick).
  const attrs: Record<string, string> = {};
  if (ev.leadId) attrs.lsq_lead_id = ev.leadId;
  if (ev.stage) attrs.lsq_stage = ev.stage;
  if (ev.ownerEmail || ev.ownerName) attrs.lsq_owner = ev.ownerName ?? ev.ownerEmail!;
  if (ev.source) attrs.lsq_source = ev.source;
  if (Object.keys(attrs).length) await setContactAttributes(canonical, attrs, tid).catch(() => undefined);

  // 2b) Stage drips (Phase 6): a stage TRANSITION starts the new stage's
  // nurture sequence and stops the other stage-managed ones. Idempotent
  // (replayed webhooks carry the same stage → no-op); opt-outs never enroll.
  let drip: { enrolled: string | null; stopped: number } | undefined;
  if (ev.stage && ev.stage !== prevStage) {
    const t = stageTransition(prevStage, ev.stage, await getStageDrips(tid));
    if (t.enroll || t.stop.length) {
      for (const sid of t.stop) await stopEnrollment(sid, canonical).catch(() => undefined);
      let enrolled: string | null = null;
      if (t.enroll) {
        const optedOut = (await optoutSet(tid).catch(() => new Set<string>())).has(last10(canonical));
        if (!optedOut) { await enroll(t.enroll, { phone: canonical }, tid).catch(() => undefined); enrolled = t.enroll; }
      }
      drip = { enrolled, stopped: t.stop.length };
    }
  }

  // 3) Owner → counselor assignment. assigned_to stores the team member's NAME
  //    (that's what the inbox filters/labels use), matched by email.
  let assigned: string | false = false;
  let assignNote: string | undefined;
  if (ev.ownerEmail) {
    const user = (await listUsers(tid).catch(() => []))
      .find(u => u.active && u.email.toLowerCase() === ev.ownerEmail);
    if (!user) assignNote = "owner email has no portal team member";
    else if (!user.name.trim()) assignNote = "team member has no display name — set one in Settings → Team";   // "" would UNassign
    else {
      const conv = await getConversationByPhone(canonical, tid).catch(() => null);
      if (!conv) assignNote = "no conversation yet — attribute stored, will show once the lead messages";
      else {
        await assignConversation(conv.id, user.name).catch(() => undefined);
        assigned = user.name;
      }
    }
  }

  console.log(JSON.stringify({ tag: "lsq_webhook", tenant: tid, event: ev.event, phone: `…${ev.phone.slice(-4)}`, stage: ev.stage ?? undefined, assigned: assigned || undefined, drip, note: assignNote }));
  return NextResponse.json({ handled: true, event: ev.event, phone: `…${ev.phone.slice(-4)}`, attributes: Object.keys(attrs), assigned, ...(drip ? { drip } : {}), ...(assignNote ? { note: assignNote } : {}) });
}

// LSQ's "Test" button sometimes probes with GET — confirm reachability without
// leaking anything or requiring the secret.
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST LeadSquared automation webhooks here with ?t=<workspace id> and x-lsq-secret (or ?secret=)." });
}
