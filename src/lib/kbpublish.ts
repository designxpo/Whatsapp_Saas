import { DEFAULT_TENANT_ID } from "./tenant";
// Building the vector index FROM the library.
//
// This is the step that inverts the old relationship. Embeddings used to be
// the primary store — documents went in, chunks came out, and the chunks were
// the only thing anyone could query. Now the concepts are primary and the
// index is an artifact derived from them, which can be deleted and rebuilt at
// any time without touching the knowledge.
//
// Only ACTIVE concepts are embedded. A pending concept is one somebody has yet
// to approve, and a superseded one has been replaced; neither may be
// answerable. 0106's search functions enforce the same rule in SQL, so the
// guarantee does not rest on this file alone.
import { tdb } from "./tenantdb";
import { errorMessage } from "./errors";
import { chunkText, headeredChunks, embedTexts } from "./kb";
import { listActiveConcepts, type StoredConcept } from "./kbconcepts";

export interface PublishResult {
  concepts: number;
  chunks: number;
  failed: number;
  notes: string[];
}

/** The text that gets embedded: the subject, then the answer. */
function conceptChunks(c: StoredConcept): string[] {
  const chunks = chunkText(c.body);
  // The "[title › section]" header is kept because retrieval ranks against it
  // today, and it is part of why a fees answer is not applied to the wrong
  // course. Changing the chunk boundaries AND dropping the header at once
  // would move two variables and make a bad evaluation impossible to
  // attribute.
  const label = [c.title?.trim(), c.description?.trim()].filter(Boolean).join(" — ") || c.path;
  return chunks.length ? headeredChunks(label, chunks) : [`[${label}]\n\n${c.body.trim()}`];
}

/**
 * Embed the library, or one concept of it.
 *
 * Per-concept is the normal case: editing one line should re-embed that line's
 * concept, not the 1,171 chunks of the file it arrived in, which is what a
 * document reprocess costs today. That is what kb_chunks.concept_id is for.
 */
export async function publishConcepts(opts: { conceptId?: string } = {}, tenantId = DEFAULT_TENANT_ID): Promise<PublishResult> {
  const out: PublishResult = { concepts: 0, chunks: 0, failed: 0, notes: [] };
  try {
    const all = await listActiveConcepts(undefined, tenantId);
    const targets = opts.conceptId ? all.filter(c => c.id === opts.conceptId) : all;

    for (const c of targets) {
      try {
        const contents = conceptChunks(c);
        if (!contents.length) continue;
        const embeddings = await embedTexts(contents, "RETRIEVAL_DOCUMENT", tenantId);

        // Replace this concept's vectors only. Deleting by concept rather than
        // by document is the whole point — two concepts from one upload are
        // independent now.
        await tdb(tenantId).from("kb_chunks").delete().eq("concept_id", c.id);
        const rows = contents.map((content, i) => ({
          concept_id: c.id,
          document_id: c.documentId,
          chunk_index: i,
          content,
          embedding: embeddings[i],
        }));
        for (let i = 0; i < rows.length; i += 100) {
          const { error } = await tdb(tenantId).from("kb_chunks").insert(rows.slice(i, i + 100));
          if (error) throw error;
        }
        out.concepts++;
        out.chunks += rows.length;
      } catch (err) {
        out.failed++;
        out.notes.push(`${c.path}: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    out.notes.push(errorMessage(err));
    console.error("[kb] publish failed:", errorMessage(err));
  }
  return out;
}
