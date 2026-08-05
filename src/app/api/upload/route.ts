import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { uploadPublic } from "@/lib/supabase";
import { moderateImageFile } from "@/lib/moderation";
import { errorMessage } from "@/lib/errors";

export async function POST(req: Request) {
  if (!(await requireAdmin())) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file" }, { status: 400 });
    // Screened BEFORE it reaches storage — this endpoint feeds product images,
    // the web-chat launcher icon, flow-node media and live-chat attachments, so
    // it's the single gate covering every uploaded asset a customer could see.
    const verdict = await moderateImageFile(file as File, { tenantId: (await currentTenantId()) ?? undefined, surface: "upload" });
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.reason === "too_large_to_scan"
        ? "This image is too large to safety-check (max 8MB). Please compress it and try again."
        : "This image was blocked by the content safety filter. Use a different image." }, { status: 400 });
    }
    const url = await uploadPublic(file as File);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
