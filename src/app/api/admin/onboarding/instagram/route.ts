import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, resolveInstagramAsset } from "@/lib/embeddedsignup";
import { saveInstagramChannel } from "@/lib/channels";
import { guardFeature } from "@/lib/feature-guard";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every failure below is logged with this tag as well as returned. The tenant
// sees the message in the portal; this is what lets us tell WHICH step failed
// from the server logs when they only report "it didn't connect".
const TAG = "[ig-onboarding]";

// POST — finish Instagram Embedded Signup for the current tenant.
// Body: { code, igUserId, pageId, name } from the FB.login Embedded Signup
// (Instagram login with instagram_manage_messages). Exchanges the code for a
// token and saves an Instagram channel (token encrypted at rest).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  // Parity with the manual "Add manually" route, which has always enforced both.
  // Skipping them here meant Embedded Signup could add an Instagram channel to a
  // plan that doesn't include one, and past the channel cap.
  { const gate = await guardFeature(tenantId, "ch_instagram"); if (gate) return gate; }

  let body: { code?: string; igUserId?: string; pageId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { code } = body;
  if (!code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });

  try { await enforceLimit(tenantId, "channels"); }
  catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }

  const ex = await exchangeSignupCode(code);
  if (!ex.ok || !ex.token) {
    console.error(TAG, "token exchange failed", { tenantId, error: ex.error });
    return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });
  }

  // Embedded Signup returns only a code; resolve the IG account + Page from the
  // token server-side unless the caller (manual/admin form) supplied them.
  let igUserId = body.igUserId?.trim();
  let pageId = body.pageId?.trim() || null;
  if (!igUserId) {
    const asset = await resolveInstagramAsset(ex.token);
    if (!asset.ok || !asset.igUserId) {
      console.error(TAG, "asset resolve failed", { tenantId, error: asset.error });
      return NextResponse.json({ error: asset.error || "Could not resolve Instagram account" }, { status: 502 });
    }
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
    console.log(TAG, "connected", { tenantId, channelId: channel.id, igUserId: channel.igUserId, pageId: channel.pageId });
    return NextResponse.json({
      success: true,
      channel: { id: channel.id, name: channel.name, igUserId: channel.igUserId, pageId: channel.pageId },
    });
  } catch (e) {
    console.error(TAG, "channel save failed", { tenantId, igUserId, error: e });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save channel" }, { status: 500 });
  }
}
