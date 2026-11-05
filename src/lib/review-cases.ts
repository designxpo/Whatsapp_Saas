// Complaint handling on a review — internal, and separate from the public
// reply: a reply can be posted while the complaint behind it is still being
// sorted out, so "replied" never means "resolved".
//
// A case has an assignee, a status (new → in progress → waiting on customer →
// resolved), a follow-up date and, only when a person explicitly confirms it, a
// link to a CRM contact. A reviewer's Google display name is never matched to a
// contact automatically. Every change and every private note is recorded in
// wa_review_activity with who did it.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getReview, CASE_STATUSES, type CaseStatus, type Review } from "./reviews";

export interface Actor { email: string; name: string }

export type ActivityKind = "note" | "assigned" | "status" | "follow_up" | "contact_linked" | "contact_unlinked" | "reply_posted" | "reply_removed";
export interface ReviewActivity { id: string; kind: ActivityKind; actorName: string | null; actorEmail: string | null; body: string; createdAt: string }

export const CASE_LABELS: Record<CaseStatus, string> = {
  new: "New", in_progress: "In progress", waiting_customer: "Waiting on customer", resolved: "Resolved",
};

const missing = (e: { code?: string } | null | undefined) => !!e && ["42703", "PGRST204", "42P01", "PGRST205"].includes(e.code ?? "");

export async function logReviewActivity(tenantId: string, reviewId: string, kind: ActivityKind, body: string, actor: Actor | null): Promise<void> {
  const { error } = await tdb(tenantId).from("wa_review_activity").insert({
    review_id: reviewId, kind, body: body.slice(0, 2000), actor_email: actor?.email ?? null, actor_name: actor?.name ?? null,
  });
  if (error && !missing(error)) console.error("[review-cases] activity", tenantId, kind, error.message);
}

export async function listActivity(tenantId: string, reviewId: string): Promise<ReviewActivity[]> {
  const { data, error } = await tdb(tenantId).from("wa_review_activity")
    .select("id,kind,actor_name,actor_email,body,created_at").eq("review_id", reviewId).order("created_at", { ascending: true }).limit(200);
  if (error) return [];
  return ((data ?? []) as unknown as { id: string; kind: ActivityKind; actor_name: string | null; actor_email: string | null; body: string; created_at: string }[])
    .map(r => ({ id: r.id, kind: r.kind, actorName: r.actor_name, actorEmail: r.actor_email, body: r.body, createdAt: r.created_at }));
}

export async function addNote(tenantId: string, reviewId: string, body: string, actor: Actor): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Write a note first." };
  if (!(await getReview(reviewId, tenantId))) return { ok: false, error: "Review not found" };
  await logReviewActivity(tenantId, reviewId, "note", text, actor);
  return { ok: true };
}

export interface CasePatch {
  /** A teammate's id, or null to unassign. */
  assigneeId?: string | null;
  caseStatus?: CaseStatus | null;
  /** ISO date or date-time, or null to clear. */
  followUpAt?: string | null;
  /** A contact's id the person confirmed, or null to unlink. */
  linkedContactId?: string | null;
}

/**
 * Apply a change to a review's case. Every id is checked against this
 * workspace, so a guessed teammate or contact id from elsewhere is refused.
 */
export async function updateCase(tenantId: string, reviewId: string, patch: CasePatch, actor: Actor): Promise<{ review?: Review; error?: string; status?: number }> {
  const review = await getReview(reviewId, tenantId);
  if (!review) return { error: "Review not found", status: 404 };
  const row: Record<string, unknown> = {};
  const history: [ActivityKind, string][] = [];

  if (patch.assigneeId !== undefined && patch.assigneeId !== review.assigneeId) {
    if (patch.assigneeId) {
      const { data } = await db().from("wa_users").select("id,name,email,active,role,team").eq("tenant_id", tenantId).eq("id", patch.assigneeId).maybeSingle();
      const u = data as { id: string; name: string; email: string; active: boolean; role: string; team: string | null } | null;
      if (!u || !u.active) return { error: "That teammate isn't in this workspace.", status: 400 };
      // Someone limited to their team's locations must be able to see this one,
      // or the case would disappear from their view the moment it's theirs.
      if (u.role !== "admin" && u.team) {
        const { data: ch } = review.channelId ? await db().from("wa_channels").select("team").eq("tenant_id", tenantId).eq("id", review.channelId).maybeSingle() : { data: null };
        if (!ch || (ch as { team: string | null }).team !== u.team) return { error: `${u.name || u.email} can't see this location's reviews, so it can't be assigned to them.`, status: 400 };
      }
      history.push(["assigned", `Assigned to ${u.name || u.email}`]);
    } else history.push(["assigned", "Unassigned"]);
    row.assignee_id = patch.assigneeId;
    // Assigning an untracked review opens a case for it.
    if (patch.assigneeId && !review.caseStatus && patch.caseStatus === undefined) row.case_status = "new";
  }
  if (patch.caseStatus !== undefined && patch.caseStatus !== review.caseStatus) {
    if (patch.caseStatus !== null && !CASE_STATUSES.includes(patch.caseStatus)) return { error: "Unknown status", status: 400 };
    row.case_status = patch.caseStatus;
    history.push(["status", patch.caseStatus ? `Status: ${CASE_LABELS[patch.caseStatus]}` : "No longer tracked as a case"]);
  }
  if (patch.followUpAt !== undefined) {
    const at = patch.followUpAt ? new Date(patch.followUpAt.length <= 10 ? `${patch.followUpAt}T09:00:00` : patch.followUpAt) : null;
    if (at && Number.isNaN(at.getTime())) return { error: "That follow-up date isn't valid.", status: 400 };
    const iso = at ? at.toISOString() : null;
    if (iso !== review.followUpAt) {
      row.follow_up_at = iso;
      history.push(["follow_up", iso ? `Follow up on ${at!.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "Follow-up date cleared"]);
    }
  }
  if (patch.linkedContactId !== undefined && patch.linkedContactId !== review.linkedContactId) {
    if (patch.linkedContactId) {
      const { data } = await tdb(tenantId).from("contacts").select("id,name,phone").eq("id", patch.linkedContactId).maybeSingle();
      const c = data as { id: string; name: string; phone: string } | null;
      if (!c) return { error: "That contact isn't in this workspace.", status: 400 };
      history.push(["contact_linked", `Linked to contact ${c.name || `…${String(c.phone).slice(-4)}`} (confirmed by ${actor.name || actor.email})`]);
    } else history.push(["contact_unlinked", "Contact link removed"]);
    row.linked_contact_id = patch.linkedContactId;
  }
  if (!Object.keys(row).length) return { review };

  row.updated_at = new Date().toISOString();
  const { data, error } = await db().from("wa_reviews").update(row).eq("id", reviewId).eq("tenant_id", tenantId).select().single();
  if (error) return { error: missing(error) ? "Complaint tracking is still being set up for your workspace. Try again shortly." : error.message, status: missing(error) ? 503 : 500 };
  for (const [kind, body] of history) await logReviewActivity(tenantId, reviewId, kind, body, actor);
  return { review: (await getReview(reviewId, tenantId)) ?? (data as unknown as Review) };
}

/** Contacts matching a search, for confirming a link by hand. Name or phone; this workspace only. */
export async function searchContacts(tenantId: string, q: string): Promise<{ id: string; name: string; phone: string }[]> {
  const term = q.replace(/[,()"\\%*:]/g, " ").trim().slice(0, 60);
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const filter = digits.length >= 4 ? `phone.ilike.%${digits}%,name.ilike.%${term}%` : `name.ilike.%${term}%`;
  const { data } = await tdb(tenantId).from("contacts").select("id,name,phone").or(filter).limit(8);
  return ((data ?? []) as unknown as { id: string; name: string; phone: string }[]).map(c => ({ id: c.id, name: c.name, phone: c.phone }));
}
