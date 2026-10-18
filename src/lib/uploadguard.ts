// What may be put into public storage, and under what name.
//
// The upload bucket is PUBLIC — anything accepted here gets a URL that works
// for anyone who has it, with no session and no referrer check. That is what
// makes it useful (WhatsApp fetches media by URL, so it has to be reachable
// without our cookies) and it is also why the gate belongs at the door rather
// than at the reader.
//
// Three things are being stopped:
//
//   • SVG. It is an image everywhere in a file picker and a document with
//     <script> everywhere else. Served from the storage origin with its real
//     content type, an uploaded SVG runs script when someone opens the link.
//     nosniff does not help: the type is honestly declared, and the honest
//     type is executable. There is no safe way to serve it as an image, so it
//     is refused with an answer ("export it as PNG") rather than accepted and
//     defused.
//
//   • Size. A bucket with no cap is a cost bug waiting for a bored person, and
//     every one of these files is on its way to WhatsApp, which has its own
//     limits — accepting 500MB only to have Meta reject it helps nobody.
//
//   • The filename. It arrives from the browser and becomes part of a public
//     URL, so it carries path separators, control characters and whatever else
//     the client cares to send.
//
// Deliberately NOT stopped: a wrong declared type. Magic-byte sniffing is the
// real answer to "PNG header, SVG body" and it is not here. It matters less
// than it looks, because storage serves the file with the type we hand it, and
// we only ever hand it one off this list — so a mislabelled SVG is served as
// image/png and renders as a broken image rather than running.

/** MIME → the extension it is stored with. Nothing off this list is accepted. */
const ALLOWED: Record<string, string> = {
  // Images. No SVG; see above.
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  // Video — the formats WhatsApp and Instagram actually accept.
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  // Audio — voice-note style media steps and uploads.
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  // Documents, matching the composer's own accept list.
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

const MB = 1024 * 1024;

// Per-category, not one global number. A 25MB image is a mistake; a 25MB video
// is a Tuesday. WhatsApp's own ceilings are 5MB image / 16MB video / 100MB
// document, and staying at or under them means a file we accept is a file that
// can actually be delivered.
const SIZE_LIMIT: { prefix: string; bytes: number; label: string }[] = [
  { prefix: "image/", bytes: 5 * MB, label: "5MB" },
  { prefix: "video/", bytes: 16 * MB, label: "16MB" },
  { prefix: "audio/", bytes: 16 * MB, label: "16MB" },
  { prefix: "", bytes: 25 * MB, label: "25MB" },     // documents, and the default
];

const limitFor = (mime: string) => SIZE_LIMIT.find(l => mime.startsWith(l.prefix))!;

export interface UploadCandidate {
  type: string;
  size: number;
  name: string;
}

/**
 * Why this file may not be stored, or null if it may.
 *
 * Pure, and returns prose rather than a code: the only consumer is an upload
 * button, and "that file is 31MB — the limit is 25MB" is the whole of what the
 * person needs to know.
 */
export function uploadProblem(file: UploadCandidate): string | null {
  const mime = normaliseMime(file.type);
  if (!mime) return "That file has no type the browser could identify. Try exporting it again.";

  if (mime === "image/svg+xml") {
    // Named specifically. "SVG is not allowed" is actionable; "unsupported
    // type" sends somebody to re-pick the same file.
    return "SVG images can carry scripts, so they cannot be uploaded. Export it as a PNG and try again.";
  }
  if (!ALLOWED[mime]) {
    return `Files of type ${mime} cannot be uploaded. Images, video, PDF, Word, Excel and plain text are accepted.`;
  }

  if (!Number.isFinite(file.size) || file.size <= 0) return "That file is empty.";
  const limit = limitFor(mime);
  if (file.size > limit.bytes) {
    return `That file is ${Math.round(file.size / MB)}MB — the limit for this kind of file is ${limit.label}.`;
  }
  return null;
}

/** The content type storage should serve it with — ours, never the client's. */
export function storedContentType(type: string): string {
  const mime = normaliseMime(type);
  return ALLOWED[mime] ? mime : "application/octet-stream";
}

// `image/png; charset=binary` and `IMAGE/PNG` are the same type. Compare the
// bare, lowercased essence so a harmless parameter is not read as an unknown
// format.
function normaliseMime(type: string): string {
  return (type || "").split(";")[0].trim().toLowerCase();
}

/**
 * A storage key that is safe to put in a URL and still recognisable.
 *
 * The original basename is kept rather than replaced with a random string,
 * because a document sent over WhatsApp is shown to the recipient by its file
 * name — "Q3-brochure.pdf" is the point of the attachment, and "a8f31c.pdf"
 * makes it look like spam. So it is kept, and everything dangerous about it is
 * taken away:
 *
 *   • directory separators and traversal, so the key cannot climb the bucket
 *   • leading dots, so nothing lands as a hidden file
 *   • control and non-printing characters
 *   • the extension, which is REPLACED with the one belonging to the type we
 *     accepted — a "report.pdf.html" cannot be stored as HTML
 *
 * The timestamp prefix stays: it is what keeps two people uploading
 * "brochure.pdf" from colliding, and upsert is off.
 */
export function safeStorageName(name: string, type: string): string {
  const ext = ALLOWED[normaliseMime(type)] ?? "bin";

  const base = (name || "")
    .replace(/\\/g, "/")
    .split("/").pop()!                       // drop any directory part
    .replace(/\.[^.]*$/, "")                 // drop the client's extension
    .replace(/[\u0000-\u001f\u007f]/g, "")   // control characters
    .replace(/[^A-Za-z0-9._-]+/g, "_")       // everything else → underscore
    .replace(/^[._]+/, "")                   // no hidden files, no leading junk
    .slice(0, 80);

  return `${Date.now()}_${base || "file"}.${ext}`;
}

// Types a browser will EXECUTE when it opens the URL, rather than display.
// Relevant to inbound media, which arrives from Meta rather than from a file
// picker: a customer can send a .svg or .html as a WhatsApp document, and an
// agent opening it from the inbox would be running it on the storage origin.
const EXECUTABLE = new Set([
  "image/svg+xml", "text/html", "application/xhtml+xml", "text/xml", "application/xml",
]);

/**
 * A content type that is safe to serve from the public bucket.
 *
 * Unlike uploadProblem() this never refuses, because the caller is the inbound
 * message path and dropping a customer's attachment is worse than storing it:
 * the file is still saved and still downloadable, it just arrives as bytes
 * instead of as a page. Everything else keeps its real type so images preview
 * and video plays.
 */
export function inertContentType(mime: string): string {
  const m = normaliseMime(mime);
  return !m || EXECUTABLE.has(m) ? "application/octet-stream" : m;
}
