import { NextResponse } from "next/server";
import { listChannels, getChannel, saveChannel, deleteChannel, type Channel } from "@/lib/channels";
import { subscribeWaba } from "@/lib/embeddedsignup";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const mask = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "••••");

// GET — this tenant's channels with masked tokens (never echo full tokens).
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channels = (await listChannels(tid)).map(c => ({ ...c, token: mask(c.token) }));
    const envMode = !!process.env.META_WA_ACCESS_TOKEN && channels.length === 0;
    return NextResponse.json({ channels, envMode });
  } catch (err) {
    return NextResponse.json({ channels: [], notice: errorMessage(err) });
  }
}

// POST — create/update a channel. Leave token empty on edit to keep the old one.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  { const gate = await guardFeature((await currentTenantId()) ?? DEFAULT_TENANT_ID, "ch_whatsapp"); if (gate) return gate; }
  let body: Partial<Channel> & { name?: string; phoneId?: string; wabaId?: string; token?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.phoneId?.trim() || !body.wabaId?.trim()) {
    return NextResponse.json({ error: "name, phoneId and wabaId are required" }, { status: 400 });
  }
  if (!body.id) {
    try { await enforceLimit((await currentTenantId()) ?? DEFAULT_TENANT_ID, "channels"); }
    catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }
  }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    let token = (body.token ?? "").trim();
    if ((!token || token.includes("…")) && body.id) {
      const existing = await getChannel(body.id, tid);
      if (!existing) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      token = existing.token;
    }
    if (!token) return NextResponse.json({ error: "Access token is required" }, { status: 400 });
    const saved = await saveChannel({ ...body, name: body.name!, phoneId: body.phoneId!, wabaId: body.wabaId!, token, tenantId: tid });
    // Subscribe the WABA to our app — WITHOUT this Meta never delivers inbound
    // messages, which is exactly why a manually-added number "connected but
    // received nothing". The Embedded Signup path already does this; manual-add
    // used to skip it (unlike the Messenger/Instagram save routes). Idempotent,
    // and non-fatal: the number still saves so a bad token can be fixed + re-saved.
    const webhook = await subscribeWaba(saved.wabaId ?? body.wabaId!, token);
    logActivity(await currentUser(), "channel.save", `${saved.name} (${saved.phoneId}) — WABA webhook ${webhook.ok ? "subscribed" : `FAILED: ${webhook.error}`}`);
    return NextResponse.json({ success: true, channel: { ...saved, token: mask(saved.token) }, webhook: { ok: webhook.ok, detail: webhook.ok ? "WABA subscribed to the app's webhooks." : (webhook.error ?? "unknown error") } });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migrations 0013_channels.sql and 0070_channel_kb.sql are applied` }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await deleteChannel(body.id, tid);
    logActivity(await currentUser(), "channel.delete", body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
