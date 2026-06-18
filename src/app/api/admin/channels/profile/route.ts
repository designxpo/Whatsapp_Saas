export const maxDuration = 60;
import { NextResponse } from "next/server";
import { requireAdmin, requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getBusinessProfile, updateBusinessProfile, setProfilePicture, type BusinessProfile } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const MAX_PHOTO = 5 * 1024 * 1024;   // 5 MB — Meta caps profile photos well under this
const PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

// GET ?channelId= — the connected number's current business profile.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channel = await credsFor(new URL(req.url).searchParams.get("channelId"), tid);
    const r = await getBusinessProfile(channel);
    if (r.error) return NextResponse.json({ profile: null, notice: r.error });
    return NextResponse.json({ profile: r.profile });
  } catch (err) {
    return NextResponse.json({ profile: null, notice: errorMessage(err) });
  }
}

// POST — JSON body updates the text fields; multipart (file) sets the photo.
// Admin-role only: this changes the number's PUBLIC business profile (name, about,
// photo) shown to every customer — a brand/config change, not a member task.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return NextResponse.json({ error: "No file" }, { status: 400 });
      const f = file as File;
      if (!PHOTO_TYPES.has(f.type)) return NextResponse.json({ error: "Use a JPEG or PNG image" }, { status: 400 });
      if (f.size > MAX_PHOTO) return NextResponse.json({ error: "Image too large (max 5 MB)" }, { status: 400 });
      const channel = await credsFor((form.get("channelId") as string) || null, tid);
      const r = await setProfilePicture({ bytes: await f.arrayBuffer(), mime: f.type }, channel);
      if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
      logActivity(await currentUser(), "channel.profile", "updated photo");
      return NextResponse.json({ success: true });
    }

    const body = (await req.json()) as BusinessProfile & { channelId?: string | null };
    const channel = await credsFor(body.channelId ?? null, tid);
    const fields: BusinessProfile = {
      about: body.about, address: body.address, description: body.description,
      email: body.email, vertical: body.vertical, websites: body.websites,
    };
    const r = await updateBusinessProfile(fields, channel);
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
    logActivity(await currentUser(), "channel.profile", "updated profile");
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
