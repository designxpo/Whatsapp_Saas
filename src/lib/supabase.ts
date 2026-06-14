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
