import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, resolveInstagramAsset } from "@/lib/embeddedsignup";
import { saveInstagramChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — finish Instagram Embedded Signup for the current tenant.
// Body: { code, igUserId, pageId, name } from the FB.login Embedded Signup
// (Instagram login with instagram_manage_messages). Exchanges the code for a
// token and saves an Instagram channel (token encrypted at rest).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { code?: string; igUserId?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { code } = body;
  if (!code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });

  const ex = await exchangeSignupCode(code);
  if (!ex.ok || !ex.token) return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });

  // Embedded Signup returns only a code; resolve the IG account + Page from the
  // token server-side unless the caller (manual/admin form) supplied them.
  let igUserId = body.igUserId?.trim();
  let pageId = body.pageId?.trim() || null;
  if (!igUserId) {
    const asset = await resolveInstagramAsset(ex.token);
    if (!asset.ok || !asset.igUserId) return NextResponse.json({ error: asset.error || "Could not resolve Instagram account" }, { status: 502 });
    igUserId = asset.igUserId;
    pageId = asset.pageId ?? null;
  }

  try {
    const channel = await saveInstagramChannel({
      tenantId,
      name: body.name?.trim() || `Instagram ${igUserId}`,
      igUserId,
      pageId,
      token: ex.token,
      isDefault: false,
    });
    return NextResponse.json({
      success: true,
      channel: { id: channel.id, name: channel.name, igUserId: channel.igUserId, pageId: channel.pageId },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save channel" }, { status: 500 });
  }
}
