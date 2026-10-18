// The OKF library's portal surface: the review queue, and editing a concept.
//
// Mutations here are deliberately narrow. A concept is the thing the assistant
// answers from, so the two destructive edits — blanking a body, or inventing
// an area — are refused by the store rather than guarded here, and this route
// just reports the reason. Keeping the rule in one place means an import
// script, a future API client and this route cannot disagree about it.
import { NextResponse, after } from "next/server";
import {
  listReviewItems, listActiveConcepts, conceptAreaSummary,
  approveConcept, rejectConcept, updateConcept, convertDocumentToLibrary, conceptMismatches,
} from "@/lib/kbconcepts";
import { publishConcepts } from "@/lib/kbpublish";
import { runEval, verdict } from "@/lib/kbeval";
import { listDocuments } from "@/lib/store";
import { areaChoices } from "@/lib/kblibrary";
import { libraryLive } from "@/lib/kb";
import { errorMessage } from "@/lib/errors";
import { currentTenantId } from "@/lib/auth";

export const dynamic = "force-dynamic";
// The scan reads every chunk of every document; the default budget is not enough.
export const maxDuration = 60;

// GET — the review queue, the library by area, and (optionally) one area's
// concepts. `?area=fees` loads a single shelf rather than all 1,500 rows.
export async function GET(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  try {
    const url = new URL(req.url);
    const area = url.searchParams.get("area");

    // The mismatch scan reads every chunk of every document — 1.4 MB and
    // eleven round trips on this corpus — so it is asked for explicitly and
    // fetched on its own. Folding it into the tab's first load made opening
    // the knowledge base wait on a question nobody had asked yet.
    const wantMismatches = url.searchParams.get("mismatches") === "1";

    const [review, areas, concepts, mismatches] = await Promise.all([
      listReviewItems(undefined, tenantId),
      conceptAreaSummary(tenantId),
      area ? listActiveConcepts(area, tenantId) : Promise.resolve([]),
      wantMismatches ? conceptMismatches(tenantId).catch(() => []) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      review, areas, concepts, mismatches,
      spine: areaChoices(),
      live: libraryLive(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — resolve a review item, or save an edit.
//
// Every path that changes what the assistant can answer from re-embeds the
// affected concept afterwards, via after() so the reviewer is not left waiting
// on an embedding round trip. A re-embed touches ONE concept (kb_chunks.
// concept_id), not the 1,171 chunks of the document it arrived in.
export async function POST(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  try {
    const body = await req.json() as Record<string, unknown>;

    if (body.approve) {
      const id = String(body.approve);
      if (!await approveConcept(id, tenantId)) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
      // The retired concept's vectors go too, or the old answer stays
      // retrievable after the new one replaces it.
      after(() => publishConcepts({ conceptId: id }, tenantId));
      return NextResponse.json({ success: true });
    }

    // Fill the library from documents already uploaded. Their original files
    // are long gone, so the text is rebuilt from the stored chunks — the same
    // thing a reprocess does. Safe to run twice: a document restating itself
    // agrees with itself, so the second pass merges instead of duplicating.
    if (body.convert) {
      const docs = await listDocuments(tenantId);
      const targets = body.convert === "all" ? docs : docs.filter(d => d.id === body.convert);
      if (!targets.length) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      // Not awaited: converting ten documents is thousands of concepts and far
      // past a request timeout.
      after(async () => {
        for (const d of targets) {
          const r = await convertDocumentToLibrary(d.id, tenantId);
          console.warn(JSON.stringify({ tag: "kb_convert", doc: d.title, ...r, notes: r.notes.slice(0, 3) }));
        }
        await publishConcepts({}, tenantId);
      });
      return NextResponse.json({ success: true, converting: targets.length });
    }

    // Compare the library against the document index before trusting it.
    // Nothing here can prove the library is more ACCURATE — there is no answer
    // key — so the verdict refuses on lost coverage and otherwise hands back a
    // short list for a person to read.
    if (body.evaluate) {
      const report = await runEval(undefined, undefined, tenantId);
      return NextResponse.json({ report: { ...report, cases: undefined }, verdict: verdict(report) });
    }

    if (body.reject) {
      await rejectConcept(String(body.reject), (body.note as string)?.trim() || undefined, tenantId);
      return NextResponse.json({ success: true });
    }

    if (body.save) {
      const id = String(body.save);
      const updated = await updateConcept(id, {
        ...(body.title !== undefined ? { title: String(body.title) } : {}),
        ...(body.description !== undefined ? { description: String(body.description) } : {}),
        ...(body.body !== undefined ? { body: String(body.body) } : {}),
        ...(body.tags !== undefined ? { tags: (body.tags as string[]) ?? [] } : {}),
        ...(body.type !== undefined ? { type: String(body.type) } : {}),
        ...(body.area !== undefined ? { area: String(body.area) } : {}),
      }, tenantId);
      if (!updated) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
      after(() => publishConcepts({ conceptId: id }, tenantId));
      return NextResponse.json({ concept: updated });
    }

    return NextResponse.json({ error: "Nothing to do — expected approve, reject or save" }, { status: 400 });
  } catch (err) {
    // updateConcept throws for the two edits that would quietly break the
    // library (empty body, unknown area). Those are the caller's fault, and
    // the message is written to be shown to them verbatim.
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
