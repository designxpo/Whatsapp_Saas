import { NextResponse } from "next/server";
import { setReviewSettings } from "@/lib/reviews";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — update this tenant's review reply settings (auto threshold, signature, tone).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { autoMinStars?: number; signature?: string; tone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const settings = await setReviewSettings(tid, {
      autoMinStars: body.autoMinStars,
      signature: body.signature,
      tone: body.tone,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
