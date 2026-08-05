import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdsAccountId, uploadAdImage, uploadAdVideo, getAdImageUrls, getAdVideoThumb } from "@/lib/ads";
import { moderateImageFile } from "@/lib/moderation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET ?hashes=h1,h2  → { urls: { hash: url } }   (resolve image hashes for previews)
// GET ?videoId=x     → { thumb }                 (resolve a video thumbnail)
// Used when a draft is reopened — the local upload preview blob is gone, but the
// hash/video_id persist, so we fetch Meta's hosted URLs to re-render the preview.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const accountId = await getAdsAccountId((await currentTenantId()) ?? DEFAULT_TENANT_ID);
  if (!accountId) return NextResponse.json({ error: "Connect an ad account first" }, { status: 400 });
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");
  if (videoId) return NextResponse.json({ thumb: await getAdVideoThumb(videoId).catch(() => null) });
  const hashes = (url.searchParams.get("hashes") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return NextResponse.json({ urls: await getAdImageUrls(accountId, hashes).catch(() => ({})) });
}

// POST multipart { file } — upload media to the ad account.
// Video files (type video/* or .mp4/.mov) → advideos, returns videoId.
// Everything else → adimages, returns imageHash.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const accountId = await getAdsAccountId(tenantId);
  if (!accountId) return NextResponse.json({ error: "Connect an ad account first" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

  // Screened before it reaches Meta's ad account — an ad creative is public and
  // runs under the connected ad account, so a policy strike here is costly.
  const verdict = await moderateImageFile(file, { tenantId, surface: "broadcast_media" });
  if (!verdict.allowed) {
    return NextResponse.json({ error: verdict.reason === "too_large_to_scan"
      ? "This image is too large to safety-check (max 8MB). Please compress it and try again."
      : "This image was blocked by the content safety filter. Use a different image." }, { status: 400 });
  }

  const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (isVideo) {
    const r = await uploadAdVideo(accountId, await file.arrayBuffer(), file.name);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ success: true, videoId: r.videoId });
  }
  const r = await uploadAdImage(accountId, await file.arrayBuffer(), file.name);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ success: true, imageHash: r.hash });
}
