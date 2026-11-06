// Documents that may be out of date. A business sets a "review by" date on a
// document (a price list, timings, a policy); once it passes, the document is
// listed. Uploaded documents (not website pages, which re-sync themselves) with
// no date are listed once they're six months old.

import { tdb } from "./tenantdb";

export interface DocToReview { id: string; title: string; sourceType: string; createdAt: string; reviewBy: string | null; why: string }

const SIX_MONTHS_DAYS = 182;

export async function documentsToReview(tenantId: string, now: number = Date.now()): Promise<{ docs: DocToReview[]; setupPending?: boolean }> {
  const { data, error } = await tdb(tenantId).from("kb_documents").select("id,title,source_type,created_at,review_by,status").limit(1000);
  if (error) return { docs: [], setupPending: true };
  const today = new Date(now).toISOString().slice(0, 10);
  const old = new Date(now - SIX_MONTHS_DAYS * 86_400_000).toISOString();
  const docs: DocToReview[] = [];
  for (const d of (data ?? []) as unknown as { id: string; title: string; source_type: string; created_at: string; review_by: string | null; status: string }[]) {
    if (d.status === "failed") continue;
    if (d.review_by && d.review_by <= today) docs.push({ id: d.id, title: d.title, sourceType: d.source_type, createdAt: d.created_at, reviewBy: d.review_by, why: `Its review date (${d.review_by}) has passed.` });
    else if (!d.review_by && d.source_type !== "url" && d.created_at < old) docs.push({ id: d.id, title: d.title, sourceType: d.source_type, createdAt: d.created_at, reviewBy: null, why: "Uploaded over six months ago and never reviewed." });
  }
  return { docs: docs.sort((a, b) => (a.reviewBy ?? a.createdAt).localeCompare(b.reviewBy ?? b.createdAt)) };
}

/** Set (YYYY-MM-DD) or clear a document's review date. Marking it reviewed = setting a new date. */
export async function setReviewBy(tenantId: string, docId: string, date: string | null): Promise<{ ok?: true; error?: string; status?: number }> {
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Use a date like 2027-03-31.", status: 400 };
  const { data, error } = await tdb(tenantId).from("kb_documents").update({ review_by: date }).eq("id", docId).select("id");
  if (error) return { error: "Review dates are still being set up for your workspace.", status: 503 };
  return data?.length ? { ok: true } : { error: "Document not found", status: 404 };
}
