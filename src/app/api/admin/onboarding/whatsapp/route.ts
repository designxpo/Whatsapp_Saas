import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exchangeSignupCode, subscribeWaba, registerPhone } from "@/lib/embeddedsignup";
import { saveChannel, listWhatsappChannelsStrict, type Channel } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — finish Meta Embedded Signup for the current tenant.
// Body: { code, wabaId, phoneNumberId, name, coex?, mode? } from the FB.login
// Embedded Signup. Exchanges the code for a business token, subscribes our app
// to the tenant's WABA webhooks, and saves it as a channel (token encrypted).
//
// coex=true marks the coexistence flavour (the tenant scanned a QR from their
// WhatsApp Business phone app): the number is registered by that flow itself,
// so the Cloud API /register call is SKIPPED — it would fail on a coexistence
// number. New numbers get a best-effort /register so they can send right away.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { code?: string; wabaId?: string; phoneNumberId?: string; name?: string; coex?: boolean; mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { code, wabaId, phoneNumberId } = body;
  const coex = body.coex === true;
  if (!code) return NextResponse.json({ error: "Missing signup code" }, { status: 400 });
  if (!wabaId || !phoneNumberId) return NextResponse.json({ error: "Missing wabaId / phoneNumberId from signup" }, { status: 400 });

  // 0. What does this workspace already have? STRICT lookup (throws on query
  // failure), and BEFORE the code exchange — the signup code is single-use, so
  // a database hiccup must abort while the popup result is still repeatable.
  // Failing closed here matters twice over: a swallowed error must never let a
  // later connect steal the tenant's default sender (isFirst), and a reconnect
  // of an already-connected number must update that row in place — a duplicate
  // phone_number_id breaks inbound routing (getChannelByPhoneNumberId's
  // .maybeSingle() errors on multiple rows and the webhook falls back to
  // env-mode handling).
  let existing: Channel | undefined;
  let isFirst = false;
  try {
    const rows = await listWhatsappChannelsStrict(tenantId);
    existing = rows.find(c => c.phoneId === phoneNumberId);
    isFirst = !rows.some(c => c.active);
  } catch {
    return NextResponse.json({ error: "Could not check the workspace's existing numbers (database hiccup) — nothing was saved. Try again." }, { status: 503 });
  }

  // 1. code → business access token
  const ex = await exchangeSignupCode(code);
  if (!ex.ok || !ex.token) return NextResponse.json({ error: ex.error || "Token exchange failed" }, { status: 502 });

  // 2. subscribe our app to this WABA (inbound → our webhook)
  const sub = await subscribeWaba(wabaId, ex.token);
  if (!sub.ok) return NextResponse.json({ error: `Connected but webhook subscribe failed: ${sub.error}` }, { status: 502 });

  // 2b. Cloud API registration — NEW non-coex numbers only (see header note; a
  // reconnect was registered on first connect). Best-effort: some Embedded
  // Signup flows pre-register, and that answer is safe to surface as a notice.
  let notice: string | undefined;
  if (!coex && !existing) {
    const reg = await registerPhone(phoneNumberId, ex.token);
    if (!reg.ok) notice = `Number saved, but Cloud API registration reported: ${reg.error}. If sends fail, register it once in WhatsApp Manager.`;
  }

  // 3. persist as a channel for this tenant (token encrypted in saveChannel).
  // Reconnects refresh the token IN PLACE and must not disturb what the admin
  // configured — keep the row's default flag and AI persona. A fresh number is
  // default-for-sends only when it's the tenant's FIRST active WhatsApp number.
  try {
    const channel = await saveChannel({
      tenantId,
      ...(existing ? { id: existing.id } : {}),
      name: body.name?.trim() || existing?.name || `WhatsApp ${phoneNumberId}`,
      phoneId: phoneNumberId,
      wabaId,
      token: ex.token,
      appId: process.env.META_APP_ID ?? null,
      agentId: existing?.agentId ?? null,
      isDefault: existing ? existing.isDefault : isFirst,
      // mode/coex are only sent when they deviate from the defaults, so a
      // database missing migration 0075/0078 keeps saving (saveChannel's
      // PGRST204 guard skips a column only when the key is absent). Omission
      // also preserves an existing row's mode on reconnect.
      ...(body.mode === "manual" ? { mode: "manual" as const } : {}),
      ...(coex ? { coex: true } : {}),
    });
    // Never return the token to the client.
    return NextResponse.json({
      success: true,
      channel: { id: channel.id, name: channel.name, phoneId: channel.phoneId, wabaId: channel.wabaId, coex: channel.coex, isDefault: channel.isDefault },
      ...(notice ? { notice } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save channel";
    return NextResponse.json({ error: coex ? `${msg} — if this mentions a missing "coex" column, apply migration 0078_coex.sql` : msg }, { status: 500 });
  }
}
