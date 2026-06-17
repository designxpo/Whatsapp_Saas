export const maxDuration = 300;
import { NextResponse, after } from "next/server";
import { createDocument, listDocuments, deleteDocument, setDocStatus, type KbSourceType } from "@/lib/store";
import { ingestDocument, jsonToText, syncUrlDocument } from "@/lib/kb";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

function botEnabled(): boolean { return process.env.LLM_BOT_ENABLED !== "false"; }

// GET — list KB documents + bot status (drives the AI Assistant tab).
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const documents = await listDocuments(tid);
    return NextResponse.json({ documents, botEnabled: botEnabled() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function extToSourceType(name: string): KbSourceType | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "doc" || ext === "docx") return "docx";
  if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "json") return "text";
  return null;
}

// POST — add a document. Either multipart/form-data (file) or JSON (text/url).
// Ingestion runs after the response via after().
export async function POST(req: Request) {
  const ctype = req.headers.get("content-type") ?? "";
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
      const sourceType = extToSourceType(file.name);
      if (!sourceType) return NextResponse.json({ error: "Unsupported file type (use PDF, DOC/DOCX, TXT, MD, JSON)" }, { status: 400 });
      const title = (form.get("title") as string)?.trim() || file.name;
      const tag = (form.get("tag") as string)?.trim() || null;
      const buffer = Buffer.from(await file.arrayBuffer());
      const doc = await createDocument({ title, sourceType, sourceRef: file.name, tag }, tid);
      // .json files are flattened to readable key/value text; .md/.txt pass through as-is.
      const isJson = file.name.toLowerCase().endsWith(".json");
      const payload = sourceType === "text"
        ? { text: isJson ? jsonToText(buffer.toString("utf8")) : buffer.toString("utf8") }
        : { buffer };
      after(() => ingestDocument(doc.id, sourceType, payload, tid));
      return NextResponse.json({ document: doc });
    }

    const body = await req.json();
    // Manual "Sync now" — re-crawl a URL document on demand (re-embeds only if changed).
    if (body.resync) {
      const doc = (await listDocuments(tid)).find(d => d.id === body.resync);
      if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
      if (doc.sourceType !== "url") return NextResponse.json({ error: "Only URL documents can be re-synced" }, { status: 400 });
      await setDocStatus(doc.id, "processing", {}, tid);
      after(() => syncUrlDocument(doc));
      return NextResponse.json({ success: true });
    }
    const sourceType = body.sourceType as KbSourceType;
    if (sourceType === "text") {
      const content = (body.content as string)?.trim();
      if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
      const doc = await createDocument({ title: (body.title as string)?.trim() || "Pasted text", sourceType: "text", tag: (body.tag as string)?.trim() || null }, tid);
      after(() => ingestDocument(doc.id, "text", { text: content }, tid));
      return NextResponse.json({ document: doc });
    }
    if (sourceType === "url") {
      const url = (body.sourceRef as string)?.trim();
      if (!url || !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "valid sourceRef URL required" }, { status: 400 });
      const doc = await createDocument({ title: (body.title as string)?.trim() || url, sourceType: "url", sourceRef: url, tag: (body.tag as string)?.trim() || null }, tid);
      after(() => ingestDocument(doc.id, "url", { url }, tid));
      return NextResponse.json({ document: doc });
    }
    return NextResponse.json({ error: "sourceType must be 'text' or 'url' (or upload a file)" }, { status: 400 });
  } catch (err) {
    const m = errorMessage(err);
    const hint = /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(m)
      ? " — database unreachable. Put your real Supabase URL + service key in .env.local and run the migrations (SETUP.md §1)."
      : "";
    return NextResponse.json({ error: m + hint }, { status: 500 });
  }
}

// DELETE — remove a document (chunks cascade). Body: { id }
export async function DELETE(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    await deleteDocument(body.id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
