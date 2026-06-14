import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, subscribeWaba } from "@/lib/embeddedsignup";
import { saveChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — finish Meta Embedded Signup for the current tenant.
// Body: { code, wabaId, phoneNumberId, name } from the FB.login Embedded Signup.
// Exchanges the code for a business token, subscribes our app to the tenant's
// WABA webhooks, and saves it as a channel (token encrypted at rest).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { code?: string; wabaId?: string; phoneNumberId?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { code, wabaId, phoneNumberId } = body;
  if (!code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });
  if (!wabaId || !phoneNumberId) return NextResponse.json({ error: "Missing wabaId / phoneNumberId from signup" }, { status: 400 });

  // 1. code → business access token
  const ex = await exchangeSignupCode(code);
  if (!ex.ok || !ex.token) return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });

  // 2. subscribe our app to this WABA (inbound → our webhook)
  const sub = await subscribeWaba(wabaId, ex.token);
  if (!sub.ok) return NextResponse.json({ error: `Connected but webhook subscribe failed: ${sub.error}` }, { status: 502 });

  // 3. persist as a channel for this tenant (token encrypted in saveChannel)
  try {
    const channel = await saveChannel({
      tenantId,
      name: body.name?.trim() || `WhatsApp ${phoneNumberId}`,
      phoneId: phoneNumberId,
      wabaId,
      token: ex.token,
      appId: process.env.META_APP_ID ?? null,
      isDefault: true,
    });
    // Never return the token to the client.
    return NextResponse.json({
      success: true,
      channel: { id: channel.id, name: channel.name, phoneId: channel.phoneId, wabaId: channel.wabaId },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save channel" }, { status: 500 });
  }
}
