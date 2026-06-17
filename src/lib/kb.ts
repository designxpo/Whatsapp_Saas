import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import { replaceChunks, setDocStatus, setDocSync, listSyncableUrlDocs, matchChunks, matchChunksByTag, type KbSourceType, type KbDocument } from "./store";
import { errorMessage } from "./errors";
import { safeFetch } from "./ssrf";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

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

async function extractUrl(url: string): Promise<string> {
  const cheerio = await import("cheerio");
  // SSRF guard: validates the URL (and redirects) resolve to a public address.
  const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; wa-broadcaster KB ingest)" } });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg").remove();
  const main = $("main").text() || $("article").text() || $("body").text();
  return main.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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

// ── Chunking: paragraph-aware windows (~1000 chars) with overlap ──────────────
const TARGET = 1000;     // chars per chunk
const OVERLAP = 150;     // chars carried into the next chunk for context continuity

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); };

  for (const para of paras) {
    // A single oversized paragraph: hard-split it.
    if (para.length > TARGET * 1.5) {
      flush(); buf = "";
      for (let i = 0; i < para.length; i += TARGET - OVERLAP) {
        chunks.push(para.slice(i, i + TARGET));
      }
      continue;
    }
    if (buf.length + para.length + 2 > TARGET && buf) {
      flush();
      buf = buf.slice(Math.max(0, buf.length - OVERLAP)) + "\n\n" + para; // carry overlap
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  flush();
  return chunks;
}

// ── Full ingest: extract → chunk → embed → store. Updates document status. ────
export async function ingestDocument(docId: string, sourceType: KbSourceType, payload: { buffer?: Buffer; text?: string; url?: string }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    const text = await extractText(sourceType, payload);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await setDocStatus(docId, "failed", { error: "No extractable text found", chunkCount: 0 }, tenantId);
      return;
    }
    const embeddings = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");
    const rows = chunks.map((content, i) => ({ content, embedding: embeddings[i] }));
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
    if (chunks.length === 0) {
      await setDocStatus(doc.id, "failed", { error: "No extractable text found", chunkCount: 0 }, tid);
      return "failed";
    }
    const embeddings = await embedTexts(chunks, "RETRIEVAL_DOCUMENT");
    const n = await replaceChunks(doc.id, chunks.map((content, i) => ({ content, embedding: embeddings[i] })), tid);
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

// Retrieve top-k business-doc chunks relevant to a query (tenant-scoped). When
// primaryTag is set (a flow's masterclass etc.), strongly-matching tagged chunks
// lead; the rest of the slots fall back to the general KB — so on-topic questions
// are answered from the masterclass and off-topic ones still get a default answer.
export async function retrieve(query: string, k = 6, tenantId = DEFAULT_TENANT_ID, primaryTag?: string | null): Promise<{ content: string; similarity: number }[]> {
  const emb = await embedQuery(query);
  if (!primaryTag) return matchChunks(emb, k, tenantId);
  const PRIMARY_FLOOR = 0.5;   // below this, the tagged docs don't really cover the question → fall back
  const [tagged, general] = await Promise.all([
    matchChunksByTag(emb, k, primaryTag, tenantId).catch(() => []),
    matchChunks(emb, k, tenantId),
  ]);
  const lead = tagged.filter(c => c.similarity >= PRIMARY_FLOOR);
  const out: { content: string; similarity: number }[] = [];
  const seen = new Set<string>();
  for (const c of [...lead, ...general]) {
    if (out.length >= k) break;
    if (seen.has(c.content)) continue;
    seen.add(c.content);
    out.push({ content: c.content, similarity: c.similarity });
  }
  return out;
}
