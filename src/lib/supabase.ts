import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Defense-in-depth: this service-role client bypasses RLS and must never run in
// the browser. Hard runtime guard — throws loudly if the module is ever imported
// into client code. (Preferred upgrade: `import "server-only"` for a build-time
// error, once the `server-only` package is added.)
if (typeof window !== "undefined") {
  throw new Error("supabase.ts service-role client must never be imported into client code");
}

let cached: SupabaseClient | null = null;

// Server-only service-role client (bypasses RLS). Never import into client code.
export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const BUCKET = "wa-uploads";
let bucketEnsured = false;

export async function ensureBucket() {
  if (bucketEnsured) return;
  const supabase = db();
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) await supabase.storage.createBucket(BUCKET, { public: true });
  bucketEnsured = true;
}

// Admin file upload → public bucket. HARDENED: server-side type allowlist + size
// cap, a server-generated random key (never the client filename), and a validated
// Content-Type. SVG and HTML are refused on purpose — served from a public bucket
// origin they would execute as stored XSS on a trusted first-party domain.
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;   // 25MB
const UPLOAD_ALLOWED: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv", "text/plain": "txt",
  "video/mp4": "mp4", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav",
};
export async function uploadPublic(file: File): Promise<string> {
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const ext = UPLOAD_ALLOWED[mime];
  if (!ext) throw new Error(`Unsupported file type${mime ? ` (${mime})` : ""}. Allowed: PNG/JPG/WebP/GIF, PDF, Office docs, MP4/WebM, common audio.`);
  if (file.size > UPLOAD_MAX_BYTES) throw new Error(`File too large — max ${UPLOAD_MAX_BYTES / (1024 * 1024)}MB.`);
  const supabase = db();
  await ensureBucket();
  // Random server-generated key — the client filename is never used in the path
  // (path-segment injection / overwrite safety).
  const filename = `upload/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(filename, file, {
    contentType: mime,   // validated against the allowlist above
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
}

// Picks a sensible file extension for a stored audio clip. The extension is
// cosmetic (the browser plays by Content-Type), but a real one keeps URLs tidy.
const AUDIO_EXT: Record<string, string> = {
  ogg: "ogg", opus: "ogg", mpeg: "mp3", mp3: "mp3", mp4: "m4a", "x-m4a": "m4a",
  m4a: "m4a", aac: "aac", amr: "amr", wav: "wav", "x-wav": "wav", webm: "webm",
};

// Upload raw audio bytes (an inbound voice note) and return a public URL.
// Best-effort: returns null on any failure so the message path never breaks.
export async function uploadAudio(data: Buffer, mimeType: string): Promise<string | null> {
  try {
    const mime = (mimeType || "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
    const sub = mime.split("/")[1] || "bin";
    const ext = AUDIO_EXT[sub] || sub;
    await ensureBucket();
    const supabase = db();
    const filename = `voice/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(filename, data, { contentType: mime, upsert: false });
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}

// Sensible file extension for any stored media (image/video/document/audio).
// Cosmetic only — the browser plays/shows by Content-Type — but keeps URLs tidy.
function mediaExt(type: string, sub: string): string {
  const SPECIAL: Record<string, string> = {
    jpeg: "jpg", "svg+xml": "svg", quicktime: "mov", "3gpp": "3gp", "x-msvideo": "avi",
    "x-matroska": "mkv", opus: "ogg", "x-m4a": "m4a", msword: "doc", plain: "txt",
    "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "vnd.ms-excel": "xls",
    mpeg: type === "audio" ? "mp3" : "mpeg",      // audio/mpeg → mp3, video/mpeg → mpeg
    mp4: type === "audio" ? "m4a" : "mp4",        // audio/mp4 → m4a, video/mp4 → mp4
  };
  return SPECIAL[sub] || sub.split("+")[0] || "bin";
}

// Upload arbitrary inbound/outbound media (image, video, document, audio) and
// return a public URL. Best-effort: returns null on any failure.
export async function uploadMedia(data: Buffer, mimeType: string): Promise<string | null> {
  try {
    const mime = (mimeType || "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
    const [type, sub = "bin"] = mime.split("/");
    const folder = type === "image" ? "img" : type === "video" ? "vid" : type === "audio" ? "voice" : "file";
    await ensureBucket();
    const supabase = db();
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${mediaExt(type, sub)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(filename, data, { contentType: mime, upsert: false });
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}
