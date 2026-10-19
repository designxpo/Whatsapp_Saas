import { DEFAULT_TENANT_ID } from "./tenant";
// The OKF library's store and ingest pipeline.
//
// An upload arrives, is broken into concepts, each concept is filed into the
// fixed subject spine, and only then is it allowed — or not allowed — to
// become something the assistant answers from.
//
//     EXTRACT -> DECOMPOSE -> CLASSIFY -> MATCH -> RECONCILE -> PUBLISH
//      exists      okf.ts    kblibrary  this file  kblibrary    status
//
// The rule the whole thing exists to enforce:
//
//     an upload can never silently change what the assistant tells a lead
//
// Today a file dropped into the portal is retrievable minutes later with no
// review. Here, an upload that contradicts a published concept lands `pending`
// and the live answer keeps being used until a person chooses between them.
// Only `active` rows are ever embedded, so retrieval is never picking between
// two versions of the truth.
import { tdb } from "./tenantdb";
import { errorMessage } from "./errors";
import { decompose, conceptToText, conceptSlug, type OkfConcept } from "./okf";
import { classifyByKeywords, reconcile, areaBySlug, type LibraryConcept } from "./kblibrary";
import { getDocument, getChunks, listDocuments } from "./store";
import { findMismatches, type Mismatch } from "./kbmismatch";
import { reconstructText } from "./kb";

/**
 * Below this there is no answer under the heading, only the heading.
 *
 * Measured on the BODY, deliberately. An earlier version tested the rendered
 * text (title + description + body) against 120 characters and dropped "The
 * fee is Rs 85,000 and EMI is available over 6 months" — a complete, useful
 * answer — because the whole thing came to ninety. The fragments actually
 * worth dropping are headings with nothing beneath them: "Offers",
 * "Policies", "Important Dates", 116 of them in the real corpus. Those have
 * an empty body whatever their title says.
 */
const SUBSTANTIVE_BODY_CHARS = 40;

/**
 * How sure the classifier must be before a concept is filed without review.
 *
 * Measured over the real corpus: p50 confidence is 0.71 and only 2% of placed
 * concepts fall under 0.15, so this holds back the genuinely marginal ones
 * without flooding the queue.
 */
const MIN_CONFIDENCE = 0.15;

export interface StoredConcept {
  id: string;
  path: string;
  area: string;
  type: string;
  title: string | null;
  description: string | null;
  body: string;
  tags: string[];
  status: "active" | "pending" | "superseded";
  reviewNote: string | null;
  sources: string[];
  confidence: number | null;
  documentId: string | null;
}

const map = (r: Record<string, unknown>): StoredConcept => ({
  id: String(r.id),
  path: String(r.path ?? ""),
  area: String(r.area ?? ""),
  type: String(r.type ?? ""),
  title: (r.title as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  body: String(r.body ?? ""),
  tags: (r.tags as string[] | null) ?? [],
  status: (r.status as StoredConcept["status"]) ?? "pending",
  reviewNote: (r.review_note as string | null) ?? null,
  sources: (r.sources as string[] | null) ?? [],
  confidence: (r.confidence as number | null) ?? null,
  documentId: (r.document_id as string | null) ?? null,
});

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The concepts the assistant may answer from.
 *
 * This is the ONLY list the embedding build should ever read. A pending or
 * superseded concept reaching the vector index would reintroduce exactly the
 * problem the status column exists to remove.
 */
export async function listActiveConcepts(area?: string, tenantId = DEFAULT_TENANT_ID): Promise<StoredConcept[]> {
  let q = tdb(tenantId).from("kb_concepts").select("*").eq("status", "active");
  if (area) q = q.eq("area", area);
  const { data } = await q.order("path").limit(5000);
  return (data ?? []).map(r => map(r as unknown as Record<string, unknown>));
}

/** The review queue: what a person has to decide, oldest first. */
export async function listPendingConcepts(limit = 200, tenantId = DEFAULT_TENANT_ID): Promise<StoredConcept[]> {
  const { data } = await tdb(tenantId).from("kb_concepts").select("*")
    .eq("status", "pending").order("created_at").limit(limit);
  return (data ?? []).map(r => map(r as unknown as Record<string, unknown>));
}

async function conceptById(id: string, tenantId = DEFAULT_TENANT_ID): Promise<StoredConcept | null> {
  const { data } = await tdb(tenantId).from("kb_concepts").select("*").eq("id", id).maybeSingle();
  return data ? map(data as unknown as Record<string, unknown>) : null;
}

/** One row of the review screen: what arrived, and what it argues with. */
export interface ReviewItem {
  incoming: StoredConcept;
  /** The published concept at the same path, if there is one. */
  live: StoredConcept | null;
}

/**
 * The review queue, each pending concept paired with the answer it would
 * replace.
 *
 * The pairing is the point. "₹90,000" on its own is not a decision anybody can
 * make — a reviewer needs the figure currently being told to leads next to it,
 * or they are guessing. Without this the queue is a list of assertions with no
 * context, and the safe action (reject everything) becomes the only rational
 * one.
 */
export async function listReviewItems(limit = 100, tenantId = DEFAULT_TENANT_ID): Promise<ReviewItem[]> {
  const pending = await listPendingConcepts(limit, tenantId);
  const out: ReviewItem[] = [];
  for (const incoming of pending) {
    const { data } = await tdb(tenantId).from("kb_concepts").select("*")
      .eq("path", incoming.path).eq("status", "active").limit(1);
    const live = (data ?? [])[0];
    out.push({ incoming, live: live ? map(live as unknown as Record<string, unknown>) : null });
  }
  return out;
}

/**
 * Where two sources state different numbers for the same thing.
 *
 * Reads EVERY concept, not only the live ones. A superseded concept is where
 * most disagreements end up now that precedence resolves them automatically —
 * and the point of this report is exactly the documents that lost, because
 * those are the ones somebody has to go and correct.
 */
export async function conceptMismatches(tenantId = DEFAULT_TENANT_ID): Promise<Mismatch[]> {
  const { data } = await tdb(tenantId).from("kb_concepts").select("*").limit(5000);
  const rows = (data ?? []).map(r => map(r as unknown as Record<string, unknown>));
  if (rows.length) {
    return findMismatches(rows.map(r => ({
      path: r.path, source: r.sources[0] ?? "", tags: r.tags, body: r.body,
    })));
  }
  // Nothing converted yet. Scan the uploaded documents directly instead of
  // showing an empty panel: a contradiction between two documents exists the
  // moment both are uploaded, and waiting for a migration before mentioning
  // it helps nobody.
  return documentMismatches(tenantId);
}

/**
 * The same check against the raw uploads, for a library that does not exist
 * yet.
 *
 * Each document is one input. The subject still comes from a table's own rows,
 * so a whole file's worth of text costs nothing in precision — what is being
 * compared is "this item's standard price" either way.
 */
export async function documentMismatches(tenantId = DEFAULT_TENANT_ID): Promise<Mismatch[]> {
  try {
    const docs = await listDocuments(tenantId);
    // Sequential on purpose: many documents at thousands of chunks between them is
    // already a heavy read, and firing them together makes a slow page into a
    // burst that competes with the webhooks for the same connection pool.
    const inputs = [];
    for (const d of docs) {
      const chunks = await getChunks(d.id, tenantId).catch(() => [] as string[]);
      const body = reconstructText(chunks);
      if (!body.trim()) continue;
      inputs.push({ path: `${d.tag || "untagged"}/${d.id}.md`, source: d.title, tags: d.tag ? [d.tag] : [], body });
    }
    return findMismatches(inputs);
  } catch (err) {
    console.error("[kb] document mismatch scan failed:", errorMessage(err));
    return [];
  }
}

/** How big each area is, and how much of it is waiting on somebody. */
export async function conceptAreaSummary(tenantId = DEFAULT_TENANT_ID): Promise<{ area: string; active: number; pending: number }[]> {
  const { data } = await tdb(tenantId).from("kb_concepts").select("*").limit(5000);
  const rows = (data ?? []).map(r => map(r as unknown as Record<string, unknown>));
  const by = new Map<string, { area: string; active: number; pending: number }>();
  for (const r of rows) {
    const e = by.get(r.area) ?? { area: r.area, active: 0, pending: 0 };
    if (r.status === "active") e.active++;
    else if (r.status === "pending") e.pending++;
    by.set(r.area, e);
  }
  return [...by.values()].sort((a, b) => a.area.localeCompare(b.area));
}

export interface ConceptPatch {
  title?: string;
  description?: string | null;
  body?: string;
  tags?: string[];
  type?: string;
  area?: string;
}

/**
 * Edit one concept.
 *
 * Throws rather than silently ignoring a bad edit, because the two things it
 * refuses are both ways of quietly destroying the library:
 *
 *   - an empty body is a concept that answers nothing while still occupying
 *     its subject, so the real answer can never be found again
 *   - an unknown area is an upload inventing structure, which is exactly the
 *     rule the fixed spine exists to enforce. An editor is not exempt from it.
 *
 * Moving a concept re-addresses it, because the path IS the subject — leaving
 * `fees/...` sitting in `admissions` would make the address a lie.
 */
export async function updateConcept(id: string, patch: ConceptPatch, tenantId = DEFAULT_TENANT_ID): Promise<StoredConcept | null> {
  const current = await conceptById(id, tenantId);
  if (!current) return null;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.body !== undefined) {
    if (!patch.body.trim()) throw new Error("A concept needs a body — an empty one answers nothing.");
    row.body = patch.body;
  }
  if (patch.title !== undefined) row.title = patch.title.trim() || null;
  if (patch.description !== undefined) row.description = patch.description?.trim() || null;
  if (patch.tags !== undefined) row.tags = [...new Set(patch.tags.map(t => t.trim()).filter(Boolean))];
  if (patch.type !== undefined) row.type = patch.type.trim() || current.type;
  if (patch.area !== undefined && patch.area !== current.area) {
    if (!areaBySlug(patch.area)) throw new Error(`"${patch.area}" is not an area in the library.`);
    const destination = `${patch.area}/${current.path.split("/").pop()}`;
    // Two live concepts cannot share a path, and the database says so as
    // "duplicate key value violates unique constraint" — not a sentence
    // anybody can act on. Checked here so the message names the real problem.
    const { data: clash } = await tdb(tenantId).from("kb_concepts").select("id")
      .eq("path", destination).eq("status", "active").limit(1);
    if ((clash ?? []).some(r => (r as unknown as { id: string }).id !== id)) {
      throw new Error(`${areaBySlug(patch.area)?.title ?? patch.area} already has a concept at ${destination}. Rename this one first, or merge the two.`);
    }
    row.area = patch.area;
    row.path = destination;
  }

  await tdb(tenantId).from("kb_concepts").update(row).eq("id", id);
  return conceptById(id, tenantId);
}

// ── Review decisions ─────────────────────────────────────────────────────────

/**
 * Publish a pending concept, retiring whatever it replaces.
 *
 * The retire happens FIRST. The live row and the newcomer share a path, and a
 * partial unique index allows only one active row per path — so promoting
 * before retiring would be rejected by the database and leave the queue stuck
 * with no explanation.
 */
export async function approveConcept(id: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  try {
    const c = await conceptById(id, tenantId);
    if (!c) return false;
    await tdb(tenantId).from("kb_concepts")
      .update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("path", c.path).eq("status", "active");
    await tdb(tenantId).from("kb_concepts")
      .update({ status: "active", review_note: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    return true;
  } catch (err) {
    console.error("[kb] approve failed:", errorMessage(err));
    return false;
  }
}

/**
 * Discard a pending concept. The live answer is untouched.
 *
 * Superseded rather than deleted: a rejected upload is evidence of what
 * somebody believed, and the next person to query the same fact should be able
 * to see that it was considered and turned down.
 */
export async function rejectConcept(id: string, note?: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  try {
    await tdb(tenantId).from("kb_concepts").update({
      status: "superseded",
      review_note: note ?? "rejected in review",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return true;
  } catch (err) {
    console.error("[kb] reject failed:", errorMessage(err));
    return false;
  }
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export interface IngestResult {
  /** New subjects, now answerable. */
  published: number;
  /** Restatements folded into an existing concept. */
  merged: number;
  /** Conflicting or unplaceable — waiting for a person. */
  quarantined: number;
  /** Fragments too thin to be a concept at all. */
  skipped: number;
  /** Contradicted a better-sourced concept and was filed away unpublished. */
  outranked: number;
  /** Concepts that could not be stored. The rest of the document still went in. */
  failed: number;
  notes: string[];
}

/**
 * Turn one uploaded document into library concepts.
 *
 * Runs after the upload has been extracted to text, alongside the existing
 * chunk-and-embed path rather than instead of it — so nothing about how the
 * assistant answers changes until the library is deliberately switched on.
 */
export async function ingestToLibrary(
  doc: { id: string; title: string; tag?: string | null },
  text: string,tenantId = DEFAULT_TENANT_ID
): Promise<IngestResult> {
  const out: IngestResult = { published: 0, merged: 0, quarantined: 0, skipped: 0, outranked: 0, failed: 0, notes: [] };
  try {
    // Decompose with a placeholder area: the real one is decided per concept
    // by the classifier, because one upload routinely covers several subjects
    // and filing the whole file in one place is the mess this replaces.
    const raw = decompose({ title: doc.title, tag: doc.tag ?? null }, text, {
      type: "knowledge", area: "unfiled",
    });

    for (const c of raw) {
      // A header with nothing under it. Storing it adds no answer and fills
      // the review queue with nothing to decide.
      if (c.body.trim().length < SUBSTANTIVE_BODY_CHARS) { out.skipped++; continue; }
      // Each concept stands alone. There are no transactions across PostgREST,
      // so the realistic guarantee is not "all or nothing" but "a failure
      // costs one concept and says so". The whole loop used to sit inside one
      // try: a failure on concept 400 of 1,171 abandoned the remaining 771 and
      // returned a count that looked like a completed run. Re-running is safe
      // — a document restating itself merges — so the right move is to carry
      // on and report.
      try {
      const rendered = conceptToText(c).trim();

      const { area, confidence } = classifyByKeywords(rendered);
      const placed = area && confidence >= MIN_CONFIDENCE ? area : null;
      const filed = placeConcept(c, placed, doc);

      // Existing live concept on the same subject, if any.
      const { data } = await tdb(tenantId).from("kb_concepts").select("*")
        .eq("path", filed.path).eq("status", "active").limit(1);
      const existing = (data ?? []).map(r => map(r as unknown as Record<string, unknown>)).map(toLibrary);

      const verdict = reconcile(filed, existing, { area: placed });

      // Outranked by what is already published. Filed as superseded so the
      // decision is auditable, and NOT queued — there is nothing for a person
      // to decide when the ranking has already decided.
      if (verdict.action === "supersede-incoming") {
        await tdb(tenantId).from("kb_concepts").insert({
          path: verdict.concept.path, area: placed ?? "unfiled", type: verdict.concept.type,
          title: verdict.concept.title, body: verdict.concept.body, tags: verdict.concept.tags,
          sources: verdict.concept.sources, status: "superseded", review_note: verdict.reason,
          confidence: confidence || null, document_id: doc.id, extra: c.extra ?? {},
        }).select();
        out.outranked++;
        continue;
      }

      if (verdict.action === "merge") {
        const live = existing[0];
        await tdb(tenantId).from("kb_concepts").update({
          body: verdict.concept.body,
          tags: verdict.concept.tags,
          sources: verdict.concept.sources,
          updated_at: new Date().toISOString(),
        }).eq("path", live.path).eq("status", "active");
        out.merged++;
        continue;
      }

      // A better-sourced contradiction retires the incumbent first: the
      // partial unique index allows one active row per path, so the other
      // order is rejected by the database.
      for (const path of verdict.supersede) {
        await tdb(tenantId).from("kb_concepts")
          .update({ status: "superseded", review_note: verdict.reason, updated_at: new Date().toISOString() })
          .eq("path", path).eq("status", "active");
      }

      await tdb(tenantId).from("kb_concepts").insert({
        path: verdict.concept.path,
        area: placed ?? "unfiled",
        type: verdict.concept.type,
        title: verdict.concept.title,
        body: verdict.concept.body,
        tags: verdict.concept.tags,
        sources: verdict.concept.sources,
        status: verdict.concept.status,
        review_note: verdict.action === "quarantine" ? verdict.reason : null,
        confidence: confidence || null,
        document_id: doc.id,
        extra: c.extra ?? {},
      }).select();

      if (verdict.action === "publish") out.published++;
      else { out.quarantined++; out.notes.push(`${verdict.concept.path}: ${verdict.reason}`); }
      } catch (err) {
        out.failed++;
        out.notes.push(`${c.path}: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    console.error("[kb] library ingest failed:", errorMessage(err));
    out.notes.push(errorMessage(err));
  }
  return out;
}

/** Re-address a decomposed concept under the area the classifier chose. */
function placeConcept(
  c: OkfConcept,
  area: string | null,
  doc: { title: string; tag?: string | null },
): LibraryConcept {
  const slug = c.path.split("/").pop()?.replace(/\.md$/, "") || conceptSlug(c.title ?? doc.title);
  const a = area ? areaBySlug(area) : null;
  return {
    path: `${area ?? "unfiled"}/${slug}.md`,
    type: a?.types[0] ?? c.type,
    title: c.title ?? slug,
    body: c.body,
    tags: c.tags ?? [],
    status: "pending",
    source: doc.title,
  };
}

const toLibrary = (c: StoredConcept): LibraryConcept => ({
  path: c.path, type: c.type, title: c.title ?? "", body: c.body,
  tags: c.tags, status: c.status, source: c.sources[0] ?? "", sources: c.sources,
});

/**
 * File a document that was uploaded before the library existed.
 *
 * Documents already in the system were chunked and embedded before the library
 * existed, and their original files are long gone from the request that uploaded
 * them — so the text is rebuilt from the chunks, which is exactly what a
 * reprocess already does.
 *
 * Safe to run repeatedly. A document restating itself agrees with itself, so
 * reconcile() merges on a second pass instead of duplicating. A convert-all
 * button that doubles the library on a second click would be worse than no
 * button at all.
 */
export async function convertDocumentToLibrary(docId: string, tenantId = DEFAULT_TENANT_ID): Promise<IngestResult> {
  const doc = await getDocument(docId, tenantId).catch(() => null);
  if (!doc) return { published: 0, merged: 0, quarantined: 0, skipped: 0, outranked: 0, failed: 0, notes: [`no document ${docId}`] };
  const chunks = await getChunks(docId, tenantId).catch(() => [] as string[]);
  const text = reconstructText(chunks);
  if (!text.trim()) {
    return { published: 0, merged: 0, quarantined: 0, skipped: 0, outranked: 0, failed: 0, notes: [`${doc.title}: no recoverable text`] };
  }
  return ingestToLibrary({ id: doc.id, title: doc.title, tag: doc.tag ?? null }, text, tenantId);
}
