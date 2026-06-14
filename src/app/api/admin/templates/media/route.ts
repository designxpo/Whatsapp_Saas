export const maxDuration = 60;
import { NextResponse } from "next/server";
import { uploadSampleMedia } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";

export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024 * 1024; // Meta caps video/document samples at 16 MB
const ALLOWED = new Set([
  "image/jpeg", "image/png",
  "video/mp4", "video/3gpp",
  "application/pdf",
]);

// POST multipart { file } — uploads a SAMPLE media file to Meta's resumable
// upload API and returns the header_handle used in template submissions.
// This is the sample reviewers see; the real broadcast media is supplied
// per-send via a URL.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file" }, { status: 400 });
    const f = file as File;
    if (!ALLOWED.has(f.type)) return NextResponse.json({ error: `Unsupported type ${f.type || "unknown"} — use JPEG/PNG, MP4, or PDF` }, { status: 400 });
    if (f.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 16 MB)" }, { status: 400 });
    const channel = await credsFor((form.get("channelId") as string) || null);
    const r = await uploadSampleMedia({ bytes: await f.arrayBuffer(), mime: f.type }, channel);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ handle: r.handle });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
