// Data retention — deletes derived and system records once they are older than
// they need to be. Runs as the engine's "retention" stage (cron/process-queue).
//
// Only data the platform produced for its own purposes is aged out here. A
// business's customer conversations, contacts and orders are NEVER touched:
// how long those are kept is the business owner's decision, not ours.
//
// Work is bounded: each table is cleared a batch at a time (select a page of
// ids past the limit, delete exactly those), a few batches per table per run,
// and the run stops at the stage's deadline. A backlog drains over several runs.

import { db } from "./supabase";

// How long each kind of record is kept, in days. Change a number here and the
// next run applies it — nothing else needs editing.
export const RETENTION_DAYS = {
  sessionRefs: 90,          // wa_session_refs: per-visitor click ids (gclid/fbclid) and UTM tags — attribution reports look back weeks, not years.
  routerEvents: 180,        // wa_router_events: one row per AI routing decision, with the customer's question — enough for hit-rate trends and the KB test set.
  semanticCacheIdle: 90,    // wa_semantic_cache: cached AI answers nobody has been served (or that were created) in this long — they re-warm on the next ask.
  aiGapsResolved: 180,      // wa_ai_gaps: unanswered-question records, counted from when the team answered or dismissed them.
  aiGapsOpen: 365,          // wa_ai_gaps: unanswered-question records nobody ever dealt with, counted from when they were asked.
  emailLog: 400,            // wa_email_log: our own email send log (addresses + delivery status) — just over a year covers a yearly billing dispute.
  deletionProof: 3 * 365,   // meta_deletion_requests: proof a Meta deletion request was carried out, kept 3 years after it completed.
  inboundEvents: 30,        // wa_inbound_events: Shopify/Razorpay/etc. webhook ledger — tools retry within 3 days at most; a month leaves room to debug.
  reviewAlerts: 90,         // wa_review_alerts: notices that are only useful for weeks; the review itself is kept.
  reviewRequests: 400,      // wa_review_requests: phone numbers — enough for the yearly frequency limit and reports.
  workAlerts: 90,           // wa_work_alerts: overdue-chat and task-due notices; the chat and task themselves are kept.
  leadReads: 400,           // wa_lead_reads: the AI's past reads of a lead — enough for year-on-year "was it right?" figures.
} as const;

type Builder = { lt: (c: string, v: string) => Builder; eq: (c: string, v: unknown) => Builder; is: (c: string, v: null) => Builder; not: (c: string, op: string, v: null) => Builder };

export interface RetentionRule {
  name: string;
  table: string;
  column: string;                       // the timestamp the age is measured from
  days: number;
  where?: (q: Builder) => Builder;      // narrows which rows the limit applies to
}

export const RETENTION_RULES: RetentionRule[] = [
  { name: "session_refs", table: "wa_session_refs", column: "created_at", days: RETENTION_DAYS.sessionRefs },
  { name: "router_events", table: "wa_router_events", column: "created_at", days: RETENTION_DAYS.routerEvents },
  // last_used_at starts at creation and moves on every hit, so it is "not used or created in N days".
  { name: "semantic_cache", table: "wa_semantic_cache", column: "last_used_at", days: RETENTION_DAYS.semanticCacheIdle },
  { name: "ai_gaps_resolved", table: "wa_ai_gaps", column: "resolved_at", days: RETENTION_DAYS.aiGapsResolved },
  { name: "ai_gaps_open", table: "wa_ai_gaps", column: "created_at", days: RETENTION_DAYS.aiGapsOpen, where: q => q.is("resolved_at", null) },
  { name: "email_log", table: "wa_email_log", column: "sent_at", days: RETENTION_DAYS.emailLog },
  { name: "deletion_proof", table: "meta_deletion_requests", column: "completed_at", days: RETENTION_DAYS.deletionProof, where: q => q.eq("status", "completed") },
  { name: "inbound_events", table: "wa_inbound_events", column: "created_at", days: RETENTION_DAYS.inboundEvents },
  { name: "review_alerts", table: "wa_review_alerts", column: "created_at", days: RETENTION_DAYS.reviewAlerts },
  { name: "review_requests", table: "wa_review_requests", column: "created_at", days: RETENTION_DAYS.reviewRequests },
  { name: "work_alerts", table: "wa_work_alerts", column: "created_at", days: RETENTION_DAYS.workAlerts },
  { name: "lead_reads", table: "wa_lead_reads", column: "created_at", days: RETENTION_DAYS.leadReads },
];

// The ids go into a DELETE … WHERE id IN (…) URL: 200 uuids keep it ~8KB.
export const BATCH_SIZE = 200;
export const MAX_BATCHES_PER_RULE = 5;

const MISSING = new Set(["PGRST205", "42P01", "PGRST106", "PGRST204", "42703"]);

export function cutoffFor(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString();
}

export interface RetentionResult {
  deleted: Record<string, number>;   // rule name → rows deleted this run
  skipped: string[];                 // rules whose table/column isn't in this database yet
  errors: string[];
  backlog: boolean;                  // some rule still had more to delete when its batches ran out
  stoppedEarly: boolean;             // the deadline cut the run short
}

export async function runRetention(opts: { now?: number; deadlineAt?: number; batchSize?: number; maxBatchesPerRule?: number } = {}): Promise<RetentionResult> {
  const now = opts.now ?? Date.now();
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const maxBatches = opts.maxBatchesPerRule ?? MAX_BATCHES_PER_RULE;
  const out: RetentionResult = { deleted: {}, skipped: [], errors: [], backlog: false, stoppedEarly: false };
  // Cross-tenant on purpose: these limits are the platform's, the same for every workspace.
  const c = db();

  for (const rule of RETENTION_RULES) {
    const cutoff = cutoffFor(rule.days, now);
    out.deleted[rule.name] = 0;
    for (let b = 0; b < maxBatches; b++) {
      if (Date.now() >= deadlineAt) { out.stoppedEarly = true; return out; }
      let q = c.from(rule.table).select("id").lt(rule.column, cutoff) as unknown as Builder;
      if (rule.where) q = rule.where(q);
      const { data, error } = await (q as unknown as { limit: (n: number) => PromiseLike<{ data: { id: string }[] | null; error: { code?: string; message: string } | null }> }).limit(batchSize);
      if (error) {
        if (MISSING.has(String(error.code ?? ""))) out.skipped.push(rule.name);
        else out.errors.push(`${rule.name}: ${error.message}`);
        break;
      }
      const ids = (data ?? []).map(r => r.id);
      if (!ids.length) break;
      const del = await c.from(rule.table).delete().in("id", ids);
      if (del.error) { out.errors.push(`${rule.name}: ${del.error.message}`); break; }
      out.deleted[rule.name] += ids.length;
      if (ids.length < batchSize) break;
      if (b === maxBatches - 1) out.backlog = true;
    }
  }
  return out;
}
