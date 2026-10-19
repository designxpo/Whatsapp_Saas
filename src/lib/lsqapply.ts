import { DEFAULT_TENANT_ID } from "./tenant";
// What a LeadSquared lead change DOES to the portal, independent of how we
// heard about it.
//
// ── Why this is its own module ───────────────────────────────────────────────
//
// This logic used to live inside the webhook route's handler, which was fine
// while a webhook was the only way a stage change could reach us. It no longer
// is: LeadSquared has no API for creating an Automation, so an account that
// cannot get one configured would never start a drip at all. stagepoll.ts asks
// LeadSquared directly instead.
//
// Two callers doing the same work is exactly where behaviour drifts — the
// webhook would learn a rule the poll never did, and a lead would be treated
// differently depending on which path found it first. So there is one function
// and both call it. The route keeps its auth, parsing and HTTP shape; this
// keeps the decisions.
//
// Everything here is idempotent BY DESIGN, because the poll re-sees the same
// lead on every pass: a stage that matches the stored one does nothing, an
// owner that matches does nothing, and a welcome that already went does
// nothing. That property is what makes polling safe at all, so it is tested
// rather than assumed.
import {
  upsertContacts, setContactAttributes, getContactByPhoneLoose, optoutSet, armFlow,
} from "./store";
import { syncOwnerByPhone } from "./handover";
import { getStageDrips, stageTransition } from "./stagedrips";
import { getScoreDrips, scoreTransition } from "./scoredrips";
import { stopMarketingEnrollments, enroll, stopEnrollment } from "./sequences";
import { getLeadWelcome, shouldWelcome, toWaNumber } from "./leadwelcome";
import { sendTemplateSingle } from "./whatsapp";
import { getDefaultChannel } from "./channels";
import type { LsqEvent } from "./lsqwebhook";

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

export interface ApplyResult {
  handled: boolean;
  reason?: string;
  phone?: string;                 // masked — only the last four digits
  attributes?: string[];
  assigned?: string | false;
  moved?: boolean;
  note?: string;
  drip?: { enrolled: string | null; stopped: number };
  scoreDrip?: { enrolled: string | null; stopped: number };
  marketingStopped?: number;
  welcomed?: boolean;
}

export interface ApplyOptions {
  /**
   * Whether this caller is allowed to fire the lead-welcome template.
   *
   * The poll passes false. Today that changes nothing — the live config
   * triggers on "created" and the poll only ever reports stage_changed, so
   * shouldWelcome() already refuses it. But "safe because of a setting
   * somebody can edit in the portal" is not safe: switch lead-welcome to a
   * stage trigger and a sweep that re-reads a thousand leads would start
   * sending a cold-open template to all of them. A caller that cannot send
   * it cannot be made to by a config change.
   */
  allowWelcome?: boolean;
}

/**
 * Apply one LeadSquared lead picture to the portal.
 *
 * Never throws: every step is individually caught, because a failure in the
 * owner sync must not cost the drip enrolment that already succeeded. The
 * caller gets a report of what happened rather than an exception.
 */
export async function applyLsqLead(ev: LsqEvent, opts: ApplyOptions = {}, tenantId = DEFAULT_TENANT_ID): Promise<ApplyResult> {
  const allowWelcome = opts.allowWelcome !== false;
  if (!ev.phone) return { handled: false, reason: "no usable phone in payload" };

  // 1) Ensure the contact exists (no-op update if it already does — existing
  //    attributes win inside upsert, fresh LSQ values are applied in step 2).
  await upsertContacts([{ phone: ev.phone, name: ev.name ?? undefined, email: ev.email ?? undefined }], "leadsquared", tenantId
  ).catch(() => undefined);

  // LSQ often stores 10-digit numbers while WhatsApp is always country-coded
  // (919…) — resolve the CANONICAL stored contact (suffix-aware) so the
  // attribute stamp and conversation lookup below hit, not miss. Its CURRENT
  // lsq_stage (pre-stamp) is the "previous stage" for the drip transition.
  const existing = await getContactByPhoneLoose(ev.phone, tenantId).catch(() => null);
  const canonical = existing?.phone ?? ev.phone;
  const prevStage = existing?.attributes?.lsq_stage;
  const prevScore = existing?.attributes?.lsq_lead_score;
  const prevOwner = (existing?.attributes?.lsq_owner ?? "").trim();

  // 2) Stamp the LSQ picture (incoming wins — stage/owner changes must stick).
  const attrs: Record<string, string> = {};
  if (ev.leadId) attrs.lsq_lead_id = ev.leadId;
  if (ev.stage) attrs.lsq_stage = ev.stage;
  if (ev.ownerEmail || ev.ownerName) attrs.lsq_owner = ev.ownerName ?? ev.ownerEmail!;
  if (ev.source) attrs.lsq_source = ev.source;
  if (ev.leadScore) attrs.lsq_lead_score = ev.leadScore;

  // ── Course and city, when the CRM knows them ─────────────────────────────
  //
  // Audience rules and `{token}` params read these as ordinary contact attributes,
  // and an `attrIn` rule reads a missing value as "no" — so a lead that arrives
  // without them would quietly skip every step gated on them.
  //
  // FILL-IF-EMPTY: a value the lead told US (through a form or a flow) is better
  // evidence than one typed into the CRM months ago, so ours always wins.
  const existingAttrs = (existing?.attributes ?? {}) as Record<string, string>;
  const has = (v: unknown) => !!String(v ?? "").trim();
  if (ev.course && !has(existingAttrs.course)) attrs.course = ev.course.trim();
  if (ev.city && !has(existingAttrs.city)) attrs.city = ev.city.trim();

  if (Object.keys(attrs).length) await setContactAttributes(canonical, attrs, tenantId).catch(() => undefined);

  // 2a-ii) A counsellor just took this lead. Stop the marketing nurture.
  //
  // The two funnels have different audiences: marketing speaks to strangers
  // at scale, sales speaks as the person who owns the lead. The moment
  // somebody owns them, a mass nurture landing alongside a personal
  // conversation is what makes the automation feel cheap — so it stops. Not
  // a handover; sales journeys are started by their own triggers.
  //
  // Only on a CHANGE from unowned to owned. A replayed webhook carrying the
  // same owner is a no-op, and a reassignment between two counsellors leaves
  // everything alone — the lead was never in the marketing lane for either.
  let marketingStopped = 0;
  const nowOwner = (ev.ownerName ?? ev.ownerEmail ?? "").trim();
  if (nowOwner && !prevOwner) {
    marketingStopped = await stopMarketingEnrollments(canonical, tenantId).catch(() => 0);
  }

  // 2b) Stage drips (Phase 6): a stage TRANSITION starts the new stage's
  // nurture sequence and stops the other stage-managed ones. Idempotent
  // (a repeated stage → no-op); opt-outs never enroll.
  let drip: { enrolled: string | null; stopped: number } | undefined;
  if (ev.stage && ev.stage !== prevStage) {
    const t = stageTransition(prevStage, ev.stage, await getStageDrips(tenantId));
    if (t.enroll || t.stop.length) {
      for (const sid of t.stop) await stopEnrollment(sid, canonical, tenantId).catch(() => undefined);
      let enrolled: string | null = null;
      if (t.enroll) {
        const optedOut = (await optoutSet(tenantId).catch(() => new Set<string>())).has(last10(canonical));
        if (!optedOut) { await enroll(t.enroll, { phone: canonical }, tenantId).catch(() => undefined); enrolled = t.enroll; }
      }
      drip = { enrolled, stopped: t.stop.length };
    }
  }

  // 2b-ii) Lead-SCORE drips. The same shape as the stage drips above, on the
  // other grading LeadSquared carries: mx_Lead_Score, which a counsellor sets
  // by hand (Hot / Warm / Cold / Junk). The two are configured separately
  // because the business uses them for different things, and a lead can move
  // on one without moving on the other.
  //
  // Run as its own transition rather than folded into the stage one: a
  // payload that carries both a new stage AND a new score is a lead that
  // genuinely changed twice, and silently dropping one of the two enrolments
  // would be a bug nobody could see from the outside.
  let scoreDrip: { enrolled: string | null; stopped: number } | undefined;
  if (ev.leadScore && ev.leadScore !== prevScore) {
    const t = scoreTransition(prevScore, ev.leadScore, await getScoreDrips(tenantId));
    if (t.enroll || t.stop.length) {
      for (const sid of t.stop) await stopEnrollment(sid, canonical, tenantId).catch(() => undefined);
      let enrolled: string | null = null;
      if (t.enroll) {
        const optedOut = (await optoutSet(tenantId).catch(() => new Set<string>())).has(last10(canonical));
        if (!optedOut) { await enroll(t.enroll, { phone: canonical }, tenantId).catch(() => undefined); enrolled = t.enroll; }
      }
      scoreDrip = { enrolled, stopped: t.stop.length };
    }
  }

  // 2c) Lead-welcome automation (landing-page form → WhatsApp flow). The
  // compliant cold-lead opener: send the approved template NOW and ARM the
  // question flow, so the lead's first reply runs the interactive Q&A inside the
  // 24h window (a sequence alone can't arm a flow). Idempotent — a `wa_welcome_at`
  // stamp stops a re-submitted form from re-blasting within 30 days; opt-outs
  // never fire. Dormant until enabled + a template and flow are chosen.
  let welcomed = false;
  if (allowWelcome) {
    try {
      const cfg = await getLeadWelcome(tenantId);
      const stampedAt = existing?.attributes?.wa_welcome_at;
      const alreadyWelcomed = !!stampedAt && (Date.now() - Date.parse(stampedAt) < 30 * 86_400_000);
      const optedOut = (await optoutSet(tenantId).catch(() => new Set<string>())).has(last10(canonical));
      if (shouldWelcome(cfg, ev, prevStage, { alreadyWelcomed, optedOut })) {
        const first = (ev.name ?? "").trim().split(/\s+/)[0] || "there";
        const channel = (await getDefaultChannel(tenantId).catch(() => null)) ?? undefined;
        const waPhone = toWaNumber(canonical);   // LSQ 10-digit → 91… so WhatsApp can deliver
        const sent = await sendTemplateSingle(waPhone, cfg.templateName, cfg.languageCode, cfg.nameParam ? [first] : [], channel);
        if (sent.error) console.error("[lsq_apply] lead-welcome template failed:", sent.error);
        else {
          await armFlow([waPhone], cfg.flowId, null, tenantId).catch(() => undefined);
          await setContactAttributes(canonical, { wa_welcome_at: new Date().toISOString() }, tenantId).catch(() => undefined);
          welcomed = true;
        }
      }
    } catch (e) { console.error("[lsq_apply] lead-welcome", e); }
  }

  // 3) Owner → the portal's own idea of ownership.
  //
  //    LSQ owns a lead by PERSON; the portal owns it by NUMBER, and the number
  //    is what team scoping reads. So this both labels the chat (assigned_to,
  //    a display name) and, where the owner maps to a line, MOVES it — which is
  //    what actually lets the receiving team open it. Writing only the name was
  //    the old bug: a chat could read "Divesh" while sitting on a sales number
  //    Divesh's team could not see.
  //
  //    `lsq_owner_email` remembers who we last acted on, so a later sweep can
  //    tell a genuine re-owning apart from a replay.
  //    ── Only on a CHANGE ─────────────────────────────────────────────────
  //
  //    This used to run on every event carrying an owner, which was harmless
  //    while the only caller was a webhook nobody had configured. It stops
  //    being harmless the moment a stage automation points at a busy stage:
  //    every stage change would re-apply ownership for every lead, and
  //    somebody bulk-moving a thousand leads onto the hand-off stage would
  //    reshuffle a thousand conversations between counsellors' inboxes in a
  //    few minutes.
  //
  //    `lsq_owner_email` already remembers who we last acted on — the rolling
  //    sweep uses exactly this comparison and documents why ("only an owner
  //    CHANGE moves a lead, which is what lets a manual Hand to Ops stick").
  //    The event path simply never did the same, so the two disagreed.
  const prevOwnerEmail = (existing?.attributes?.lsq_owner_email ?? "").trim().toLowerCase();
  const ownerChanged = !!ev.ownerEmail && ev.ownerEmail.trim().toLowerCase() !== prevOwnerEmail;

  let assigned: string | false = false;
  let moved = false;
  let assignNote: string | undefined;
  if (ev.ownerEmail && ownerChanged) {
    const r = await syncOwnerByPhone(canonical, ev.ownerEmail, "leadsquared", tenantId).catch(() => null);
    if (r) {
      assigned = r.assigned ?? false;
      moved = r.moved;
      assignNote = r.note;
      await setContactAttributes(canonical, { lsq_owner_email: ev.ownerEmail }, tenantId).catch(() => undefined);
    }
  }

  return {
    handled: true,
    phone: `…${ev.phone.slice(-4)}`,
    attributes: Object.keys(attrs),
    assigned,
    ...(moved ? { moved } : {}),
    ...(drip ? { drip } : {}),
    ...(scoreDrip ? { scoreDrip } : {}),
    ...(marketingStopped ? { marketingStopped } : {}),
    ...(welcomed ? { welcomed } : {}),
    ...(assignNote ? { note: assignNote } : {}),
  };
}
