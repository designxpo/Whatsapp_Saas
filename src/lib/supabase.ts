import { uploadProblem, safeStorageName, storedContentType, inertContentType } from "./uploadguard";
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
// Thrown when a file is not one we store. The message is written for the person
// who picked the file ("SVG images can carry scripts…"), so the route hands it
// back as a 400 instead of a generic failure.
export class UploadRefused extends Error {}

export async function uploadPublic(file: File): Promise<string> {
  // What may go into the PUBLIC bucket, how big, and under what name — all decided
  // in uploadguard.ts, which is pure and tested on its own.
  const problem = uploadProblem({ type: file.type, size: file.size, name: file.name });
  if (problem) throw new UploadRefused(problem);
  const supabase = db();
  await ensureBucket();
  // The readable original name is kept (a document sent over WhatsApp is shown to
  // the recipient by it) with everything dangerous about it removed, behind a
  // random token so two uploads of "brochure.pdf" can never collide or be guessed.
  const filename = `upload/${Math.random().toString(36).slice(2, 10)}_${safeStorageName(file.name, file.type)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(filename, file, {
    // OUR content type for the accepted kind, never the client's string.
    contentType: storedContentType(file.type),
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
    const { error } = await supabase.storage.from(BUCKET).upload(filename, data, { contentType: inertContentType(mime), upsert: false });   // the sender chooses the declared type, and this bucket is public
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
    const { error } = await supabase.storage.from(BUCKET).upload(filename, data, { contentType: inertContentType(mime), upsert: false });   // the sender chooses the declared type, and this bucket is public
    if (error) return null;
    return supabase.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}
