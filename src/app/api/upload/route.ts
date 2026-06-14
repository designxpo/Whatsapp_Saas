import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { uploadPublic } from "@/lib/supabase";

export async function POST(req: Request) {
  if (!(await requireAdmin())) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file" }, { status: 400 });
    const url = await uploadPublic(file as File);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
