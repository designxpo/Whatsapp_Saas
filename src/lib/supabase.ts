import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export async function uploadPublic(file: File): Promise<string> {
  const supabase = db();
  await ensureBucket();
  const filename = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
  const { error } = await supabase.storage.from(BUCKET).upload(filename, file, {
    contentType: file.type || undefined,
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
