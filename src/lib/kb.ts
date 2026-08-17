import { DEFAULT_TENANT_ID } from "./tenant";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import { replaceChunks, setDocStatus, setDocSync, listSyncableUrlDocs, matchChunks, matchChunksByTag, matchChunksText, matchChunksTextByTag, getDocument, getChunks, type KbSourceType, type KbDocument } from "./store";
import { errorMessage } from "./errors";
import { safeFetch } from "./ssrf";


// pdf-parse / mammoth / cheerio are loaded lazily inside the extract functions:
// they do native/global work that crashes if evaluated at module load inside a
// bundled route, and listing documents shouldn't pay to load them at all.

// Embedding dimension — MUST match the vector(768) column in 0003_kb.sql.
export const EMBED_DIM = 768;
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

let client: GoogleGenAI | null = null;
function genai(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// Embed a batch of texts. taskType tunes the embedding for storage vs. querying.
export async function embedTexts(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await genai().models.embedContent({
      model: EMBED_MODEL,
      contents: batch,
      config: { taskType, outputDimensionality: EMBED_DIM },
    });
    const embeddings = res.embeddings ?? [];
    if (embeddings.length !== batch.length) throw new Error(`Embedding count mismatch: got ${embeddings.length} for ${batch.length} inputs`);
    for (const e of embeddings) {
      if (!e.values || e.values.length !== EMBED_DIM) throw new Error(`Unexpected embedding dimension: ${e.values?.length ?? 0}`);
      out.push(e.values);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text], "RETRIEVAL_QUERY");
  return v;
}

// ── Text extraction per source type ───────────────────────────────────────────
async function extractPdf(buffer: Buffer): Promise<string> {
  // pdfjs-dist (inside pdf-parse) uses the browser `DOMMatrix` global unguarded;
  // install a Node polyfill before it loads, or some PDFs fail with
  // "DOMMatrix is not defined".
  await import("./dommatrix-polyfill");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const r = await parser.getText();
    return r.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

// Placeholder copy a page shows BEFORE client-side JS renders the real content —
// "Loading…", "Preparing awesomeness…", a bare "Skip to content". Real content
// always dwarfs any spinner, so a short body that reads like this means nothing
// actually rendered on the server.
function isLoadingShell(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length > 300) return false;   // real content is longer than any spinner copy
  // Spinner-specific — deliberately NOT a bare "loading" (a real "loading dock"
  // page must survive). Only "loading…/loading..." or "<thing> is loading" count.
  return t === "skip to content"
    || /\b(?:preparing|please wait|just a moment|one moment|redirecting)\b/.test(t)
    || /\bloading\s*(?:[…·•]|\.\.\.|$)/.test(t)
    || /\b(?:is|now|still|page|content|site)\s+loading\b/.test(t);
}

// Keep human prose, drop the code/markup/CSS that also lives in an embedded payload
// (Tailwind class lists, RSC ids, minified JS, JSON keys). Deliberately recall-
// biased: a little noise is harmless to embeddings, but dropping real sentences
// costs KB coverage.
function looksLikeProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 20 || t.length > 4000) return false;
  const words = t.split(/\s+/);
  if (words.length < 5) return false;                                                              // needs to be a phrase, not a token
  if (/[{}<>=\\|]|=>|::|\/\/|@media|;\s*}|\$\{|\bfunction\b/.test(t)) return false;                 // code / markup
  if (/(?:^|\s)(?:sm|md|lg|xl|2xl|hover|focus|active|group|peer|dark|first|last|odd|even|disabled|before|after|placeholder|motion-safe|motion-reduce|aria|data)[-:]/.test(t)) return false;  // utility classes
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters / t.length < 0.6) return false;                                                       // enough real letters
  const tokeny = words.filter(w => /[-_]/.test(w) || /\d/.test(w)).length;
  if (tokeny / words.length > 0.4) return false;                                                    // class-list / id soup
  return true;
}

// Recover readable text embedded in the INITIAL HTML by JS frameworks — WITHOUT a
// headless browser (which won't run on serverless). A React/Next site serves a
// near-empty DOM but ships the real page text in one of:
//   • Next.js App Router RSC flight data  (self.__next_f.push([1,"…"]))
//   • JSON script blocks                  (__NEXT_DATA__, <script type="application/json">)
//   • JSON-LD structured data             (<script type="application/ld+json">)
// Parsing them is what lets a JS-rendered site ingest at all instead of storing a
// spinner. Excluding the double-quote from the prose scan makes JSON boundaries
// split keys from values, so we mine clean string VALUES, not "key":"value" soup.
export function extractEmbeddedText(html: string): string {
  const out: string[] = [];
  const push = (s: string) => { if (looksLikeProse(s)) out.push(s.trim()); };

  // 1) RSC flight payload — concatenate every pushed chunk, then mine prose runs
  //    out of the (RSC-encoded) blob; the scan breaks at markup/quote boundaries.
  let flightBlob = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
    try { flightBlob += JSON.parse(m[1]); } catch { /* skip malformed chunk */ }
  }
  if (flightBlob) for (const frag of flightBlob.match(/[\p{L}][\p{L}\p{N} ,.'’:;!?&()/–—-]{19,}/gu) || []) push(frag);

  // 2) + 3) JSON / JSON-LD script blocks — walk every string value (clean by design).
  for (const m of html.matchAll(/<script[^>]*type=["'](?:application\/json|application\/ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown): void => {
        if (typeof n === "string") push(n);
        else if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") Object.values(n as Record<string, unknown>).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* not JSON — skip */ }
  }

  // De-dupe, preserve first-seen order (keeps the page's natural reading flow).
  return [...new Set(out)].join("\n");
}

// Turn a fetched HTML page into KB text. Prefers the rendered DOM (server-rendered
// pages — unchanged behaviour), and when that's thin (a JS-rendered site that ships
// only a loading shell) recovers the content the framework embedded in the initial
// HTML instead. Throws a guidance error when nothing readable exists, so the doc
// FAILS LOUDLY with a fix rather than silently storing a spinner as "ready". Split
// out from extractUrl so it's unit-testable with no network fetch.
export async function extractReadableText(html: string): Promise<string> {
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg").remove();
  const dom = ($("main").text() || $("article").text() || $("body").text())
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Server-rendered page with real content: use it directly — the embedded payload
  // would only duplicate it. Keeps every currently-working SSR doc identical.
  if (dom.length >= 500 && !isLoadingShell(dom)) return dom;

  // Thin/loading DOM → recover the framework-embedded content, keeping the richer
  // of the two (some sites SSR a little AND embed the rest).
  const embedded = extractEmbeddedText(html);
  const best = embedded.length > dom.length ? embedded : dom;

  if (best.replace(/\s/g, "").length < 80 || isLoadingShell(best)) {
    throw new Error(
      "The page loaded but exposed no readable text — it renders its content with JavaScript. " +
      "Paste the text into the KB as a Text document, or point the URL at a server-rendered page.",
    );
  }
  return best;
}

async function extractUrl(url: string): Promise<string> {
  // SSRF guard: validates the URL (and redirects) resolve to a public address.
  const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; wa-broadcaster KB ingest)" } });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  return extractReadableText(await res.text());
}

export async function extractText(sourceType: KbSourceType, payload: { buffer?: Buffer; text?: string; url?: string }): Promise<string> {
  switch (sourceType) {
    case "pdf": return extractPdf(payload.buffer!);
    case "docx": return extractDocx(payload.buffer!);
    case "url": return extractUrl(payload.url!);
    case "text": return (payload.text ?? "").trim();
  }
}

// Flatten arbitrary JSON into readable "key: value" lines so the embedder sees
// the content, not braces and brackets. Each object becomes a block separated by
// a blank line (so the chunker keeps related fields together). Invalid JSON falls
// back to the raw text. Stored under the "text" source type (no schema change).
export function jsonToText(raw: string): string {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return raw.trim(); }
  const out: string[] = [];
  const walk = (node: unknown, key: string) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const v of node) { walk(v, key); if (v && typeof v === "object") out.push(""); }
    } else if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k);
    } else {
      out.push(`${key ? key + ": " : ""}${String(node)}`);
    }
  };
  walk(data, "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── "Did we actually extract anything?" ──────────────────────────────────────
// A scanned PDF — a photo of a page, with no text layer — extracts to nothing
// but the page separators the parser emits. That still chunks to ONE non-empty
// chunk, so a `chunks.length === 0` guard waves it through, and the document is
// stored, embedded and shown to the tenant as "ready".
//
// Found live: a tenant's entire knowledge base was one 53-character chunk
// reading "[bolt knowledge base.pdf] -- 1 of 2 -- -- 2 of 2 --". Their portal
// said ready, their AI answered every question ungrounded, and nothing in the
// product could have told them. Count real characters, not chunks.
const PAGE_MARKER = /^[\s>|]*-{1,3}\s*\d+\s+of\s+\d+\s*-{1,3}[\s>|]*$/gim;

/** Letters and digits left once page furniture and whitespace are removed. */
export function readableCharCount(text: string): number {
  return (text || "").replace(PAGE_MARKER, " ").replace(/[^\p{L}\p{N}]+/gu, "").length;
}

// Deliberately low. The point is to separate "a document" from "no text at all",
// not to judge whether a short document is worth keeping — a tenant may legitimately
// upload a twenty-word price list.
const MIN_READABLE_CHARS = 25;

export function hasUsableText(text: string): boolean {
  return readableCharCount(text) >= MIN_READABLE_CHARS;
}

// Says what went wrong AND what to do about it — "No extractable text found" left
// a tenant staring at a PDF that opens perfectly well on their screen.
export const NO_TEXT_ERROR =
  "No readable text in this file — it looks like a scan or images of pages rather than a text document. " +
  "Run it through OCR, export a text-based PDF, or paste the content in directly.";

// ── Chunking: heading-aware paragraph windows (~1000 chars) with overlap ──────
const TARGET = 1000;     // chars per chunk
const OVERLAP = 150;     // chars carried into the next chunk for context continuity

// A chunk plus the nearest section heading above it, so the caller can prepend a
// "[Document › Section]" context line — what stops a price/schedule chunk from
// being applied to the wrong product/service.
export interface KbChunk { content: string; heading: string | null }

// Is this paragraph a SECTION HEADING (a label for what follows), not body text?
// We are deliberately conservative — only signals that are almost never real data:
//   • a markdown heading            "## Fees", "### Eligibility"
//   • a bare label line             "Fees:", "Course Duration :"  (colon, nothing after)
// A "key: value" line ("Fees: ₹50,000") is DATA and stays in the body. Anything
// flagged as a heading rides on the next chunk as its prefix, so it is never lost.
function asHeading(para: string): string | null {
  const line = para.trim();
  if (!line || line.includes("\n") || line.length > 60) return null;
  const md = line.match(/^#{1,6}\s+(.{1,58})$/);
  if (md) return md[1].trim();
  const label = line.match(/^([A-Za-z][\w &/().'+-]{1,56}):$/);   // colon, nothing after
  if (label) return label[1].trim();
  return null;
}

// Heading-aware splitter. Returns each chunk tagged with the section it falls
// under. A heading both opens a new section AND forces a chunk boundary, so one
// section's content never shares a chunk with another's.
export function chunkText(text: string): KbChunk[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: KbChunk[] = [];
  let buf = "";
  let section: string | null = null;     // the heading currently in effect
  let bufSection: string | null = null;  // the heading captured when buf started
  const flush = () => { if (buf.trim()) chunks.push({ content: buf.trim(), heading: bufSection }); };

  for (const para of paras) {
    const head = asHeading(para);
    // A heading opens a new section AND a new chunk boundary. We keep the heading
    // line in the body (normalized to "## x" so it's always re-detected) — this is
    // what lets headings survive a later reconstruct/reprocess — and also expose it
    // as the chunk's section label for the "[doc › section]" prefix.
    if (head) { flush(); buf = "## " + head; section = head; bufSection = head; continue; }

    // Oversized block (a big table or one long paragraph): split on LINE
    // boundaries so table rows / list items stay intact (never mid-row); only a
    // single monster line with no breaks is hard-split mid-char as a last resort.
    if (para.length > TARGET * 1.5) {
      flush(); buf = ""; bufSection = section;
      let sub = "";
      const flushSub = () => { if (sub.trim()) chunks.push({ content: sub.trim(), heading: section }); sub = ""; };
      for (const ln of para.split("\n")) {
        if (ln.length > TARGET * 1.5) {
          flushSub();
          for (let i = 0; i < ln.length; i += TARGET - OVERLAP) chunks.push({ content: ln.slice(i, i + TARGET), heading: section });
          continue;
        }
        if (sub.length + ln.length + 1 > TARGET && sub) { flushSub(); sub = ln; }
        else sub = sub ? sub + "\n" + ln : ln;
      }
      flushSub();
      continue;
    }

    if (buf.length + para.length + 2 > TARGET && buf) {
      flush();
      buf = buf.slice(Math.max(0, buf.length - OVERLAP)) + "\n\n" + para;   // carry overlap
      bufSection = section;
    } else {
      if (!buf) bufSection = section;
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  flush();
  return chunks;
}

// Prepend a compact context header to every chunk so BOTH the embedding and the
// model know which document/section the text came from. This is the core of the
// "brand-centric" fix — each chunk now self-identifies its document/section.
export function headeredChunks(title: string, chunks: KbChunk[]): string[] {
  const t = (title || "").trim().slice(0, 120);
  return chunks.map(c => {
    const label = c.heading ? `${t} › ${c.heading}` : t;
    return label ? `[${label}]\n\n${c.content}` : c.content;
  });
}

// ── Reconstruct original text from stored chunks (for re-processing) ───────────
// The raw source text isn't retained — only chunks are. To re-chunk an existing
// document with an improved chunker WITHOUT a re-upload, we rebuild its text from
// the stored chunks: strip the "[…]" context header we prepended, then merge out
// the per-chunk character overlap so sentences aren't duplicated.
const HEADER_PREFIX_RE = /^\[[^\]\n]{1,160}\]\n\n/;
function stripHeader(content: string): string {
  return content.replace(HEADER_PREFIX_RE, "");
}
// Append b to a, collapsing the largest suffix-of-a == prefix-of-b overlap. The
// TRUE per-chunk overlap is never more than OVERLAP (150) chars, so we cap the
// search there — capping higher lets periodic/repetitive text (e.g. a no-newline
// blob hard-split mid-char) match BEYOND the real overlap and drop real content.
// The ≥40 floor keeps a coincidental short collision from collapsing distinct text.
function mergeOverlap(a: string, b: string, maxOverlap = OVERLAP): string {
  const max = Math.min(maxOverlap, a.length, b.length);
  for (let len = max; len >= 40; len--) {
    if (a.slice(a.length - len) === b.slice(0, len)) return a + b.slice(len);
  }
  return a + "\n\n" + b;
}
export function reconstructText(chunkContents: string[]): string {
  let out = "";
  for (const raw of chunkContents) {
    const body = stripHeader(raw).trim();
    if (!body) continue;
    out = out ? mergeOverlap(out, body) : body;
  }
  return out;
}

// ── Full ingest: extract → chunk → embed → store. Updates document status. ────
export async function ingestDocument(docId: string, sourceType: KbSourceType, payload: { buffer?: Buffer; text?: string; url?: string }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    const text = await extractText(sourceType, payload);
    const chunks = chunkText(text);
    // Both conditions matter: no chunks at all, and chunks carrying no actual
    // words (a scanned PDF yields page markers, which chunk to exactly one).
    if (chunks.length === 0 || !hasUsableText(text)) {
      await setDocStatus(docId, "failed", { error: NO_TEXT_ERROR, chunkCount: 0 }, tenantId);
      return;
    }
    const doc = await getDocument(docId, tenantId).catch(() => null);   // for the "[title › section]" header
    const contents = headeredChunks(doc?.title ?? "", chunks);
    const embeddings = await embedTexts(contents, "RETRIEVAL_DOCUMENT");
    const rows = contents.map((content, i) => ({ content, embedding: embeddings[i] }));
    const n = await replaceChunks(docId, rows, tenantId);
    await setDocStatus(docId, "ready", { chunkCount: n, error: null }, tenantId);
    await setDocSync(docId, sha256(text), tenantId);   // baseline hash for future change detection
  } catch (err) {
    await setDocStatus(docId, "failed", { error: errorMessage(err) }, tenantId);
  }
}

function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }

// Re-crawl one URL document (tenant taken from the doc). Re-embeds only when the
// fetched content differs from the stored hash; otherwise just stamps the sync
// time. Keeps the KB in step with the organisation's source page automatically.
export async function syncUrlDocument(doc: KbDocument): Promise<"updated" | "unchanged" | "failed"> {
  if (doc.sourceType !== "url" || !doc.sourceRef) return "failed";
  const tid = doc.tenantId;
  try {
    const text = await extractText("url", { url: doc.sourceRef });
    const hash = sha256(text);
    if (doc.contentHash && hash === doc.contentHash) {
      await setDocStatus(doc.id, "ready", { error: null }, tid);   // clear any prior processing/failed
      await setDocSync(doc.id, hash, tid);
      return "unchanged";
    }
    const chunks = chunkText(text);
    if (chunks.length === 0 || !hasUsableText(text)) {
      await setDocStatus(doc.id, "failed", { error: NO_TEXT_ERROR, chunkCount: 0 }, tid);
      return "failed";
    }
    const contents = headeredChunks(doc.title, chunks);
    const embeddings = await embedTexts(contents, "RETRIEVAL_DOCUMENT");
    const n = await replaceChunks(doc.id, contents.map((content, i) => ({ content, embedding: embeddings[i] })), tid);
    await setDocStatus(doc.id, "ready", { chunkCount: n, error: null }, tid);
    await setDocSync(doc.id, hash, tid);
    return "updated";
  } catch (err) {
    await setDocStatus(doc.id, "failed", { error: errorMessage(err) }, tid);
    return "failed";
  }
}

// Cron entry — re-crawl URL docs (all tenants) not synced within olderThanHours,
// capped per run. Dormant (no-op) until the 0032 auto-sync columns exist.
export async function refreshDueUrlDocuments(opts: { olderThanHours?: number; max?: number } = {}): Promise<{ checked: number; updated: number; unchanged: number; failed: number }> {
  const docs = await listSyncableUrlDocs((opts.olderThanHours ?? 6) * 3600_000, opts.max ?? 3);
  let updated = 0, unchanged = 0, failed = 0;
  for (const doc of docs) {
    const r = await syncUrlDocument(doc);
    if (r === "updated") updated++; else if (r === "unchanged") unchanged++; else failed++;
  }
  return { checked: docs.length, updated, unchanged, failed };
}

// Re-chunk + re-embed an EXISTING document with the current chunker — used to roll
// an improved chunking/header strategy onto a tenant's live KB with no re-upload.
// URL docs are re-crawled (freshest source); everything else is rebuilt from its
// stored chunks. Replaces the document's chunks in place.
export async function reingestDocument(doc: KbDocument): Promise<"updated" | "failed"> {
  const tid = doc.tenantId;
  try {
    const text = doc.sourceType === "url" && doc.sourceRef
      ? await extractText("url", { url: doc.sourceRef })
      : reconstructText(await getChunks(doc.id, tid));
    if (!text.trim()) {
      await setDocStatus(doc.id, "failed", { error: "Nothing to reprocess (no stored text)", chunkCount: 0 }, tid);
      return "failed";
    }
    const chunks = chunkText(text);
    if (chunks.length === 0 || !hasUsableText(text)) {
      await setDocStatus(doc.id, "failed", { error: NO_TEXT_ERROR, chunkCount: 0 }, tid);
      return "failed";
    }
    const contents = headeredChunks(doc.title, chunks);
    const embeddings = await embedTexts(contents, "RETRIEVAL_DOCUMENT");
    const n = await replaceChunks(doc.id, contents.map((content, i) => ({ content, embedding: embeddings[i] })), tid);
    await setDocStatus(doc.id, "ready", { chunkCount: n, error: null }, tid);
    await setDocSync(doc.id, sha256(text), tid);
    return "updated";
  } catch (err) {
    await setDocStatus(doc.id, "failed", { error: errorMessage(err) }, tid);
    return "failed";
  }
}

// Cheap "does this tenant's KB actually cover this question?" probe. Embeds the
// query once and checks the single best chunk against the same relevance floor RAG
// uses (llm.ts MIN_SIMILARITY). The router calls this before letting a canned
// FAQ/cache DEFLECTION ("contact our counsellor") stand: if the KB has the answer,
// we defer to it. Returns the embedding so the caller can reuse it (no double cost).
const COVERAGE_FLOOR = 0.45;   // keep in sync with MIN_SIMILARITY in llm.ts
export async function kbCoverage(query: string, tenantId = DEFAULT_TENANT_ID, embedding?: number[] | null): Promise<{ covered: boolean; top: number; embedding: number[] }> {
  const emb = embedding ?? await embedQuery(query);
  const top = (await matchChunks(emb, 1, tenantId))[0]?.similarity ?? 0;
  return { covered: top >= COVERAGE_FLOOR, top, embedding: emb };
}

// Retrieve top-k business-doc chunks relevant to a query (tenant-scoped). When
// primaryTag is set (a flow's masterclass etc.), strongly-matching tagged chunks
// lead; the rest of the slots fall back to the general KB — so on-topic questions
// are answered from the masterclass and off-topic ones still get a default answer.
// ── Hybrid retrieval (vector + keyword, fused by RRF) ─────────────────────────
const RRF_K = 60;            // standard Reciprocal Rank Fusion constant
const VEC_FLOOR = 0.45;      // drop weak vector hits before fusing (matches MIN_SIMILARITY in llm.ts)
const KW_SIM = 0.5;          // similarity assigned to a keyword match (survives the floor)
const HYBRID_POOL = 20;      // candidates pulled from each retriever before fusion

// Reciprocal Rank Fusion: combine the vector list and the keyword list by RANK,
// not raw score (the two scores aren't comparable). A chunk both retrievers rank
// highly rises to the top; an exact-term match only keyword search found is still
// recovered. `similarity` carries the real cosine for a vector hit, and at least
// KW_SIM for any keyword hit, so the downstream relevance floor keeps it.
export function fuseHybrid(
  vec: { content: string; similarity: number }[],
  kw: { content: string; rank: number }[],
  k: number,
): { content: string; similarity: number }[] {
  const score = new Map<string, number>();
  const sim = new Map<string, number>();
  const bump = (content: string, rank: number) => score.set(content, (score.get(content) ?? 0) + 1 / (RRF_K + rank + 1));
  vec.forEach((c, i) => { bump(c.content, i); sim.set(c.content, c.similarity); });
  kw.forEach((c, i) => { bump(c.content, i); sim.set(c.content, Math.max(sim.get(c.content) ?? 0, KW_SIM)); });
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([content]) => ({ content, similarity: sim.get(content) ?? KW_SIM }));
}

export async function retrieve(query: string, k = 6, tenantId = DEFAULT_TENANT_ID, primaryTag?: string | null): Promise<{ content: string; similarity: number }[]> {
  const q = (query || "").trim();
  if (!q) return [];
  const emb = await embedQuery(q);

  if (!primaryTag) {
    const [vec, kw] = await Promise.all([
      matchChunks(emb, HYBRID_POOL, tenantId).catch(() => []),
      matchChunksText(q, HYBRID_POOL, tenantId),
    ]);
    return fuseHybrid(vec.filter(c => c.similarity >= VEC_FLOOR), kw, k);
  }

  // A flow-set KB tag is set → answer EXCLUSIVELY from that tag's docs so
  // another item's price/duration/details can never bleed in. Only when the
  // tagged docs genuinely don't cover the question (neither retriever finds
  // anything) do we fall back to the general KB.
  const PRIMARY_FLOOR = 0.5;
  const [vecTag, kwTag] = await Promise.all([
    matchChunksByTag(emb, HYBRID_POOL, primaryTag, tenantId).catch(() => []),
    matchChunksTextByTag(q, HYBRID_POOL, primaryTag, tenantId),
  ]);
  const vecLead = vecTag.filter(c => c.similarity >= PRIMARY_FLOOR);
  if (vecLead.length || kwTag.length) return fuseHybrid(vecLead, kwTag, k);

  const [vec, kw] = await Promise.all([
    matchChunks(emb, HYBRID_POOL, tenantId).catch(() => []),
    matchChunksText(q, HYBRID_POOL, tenantId),
  ]);
  return fuseHybrid(vec.filter(c => c.similarity >= VEC_FLOOR), kw, k);
}
