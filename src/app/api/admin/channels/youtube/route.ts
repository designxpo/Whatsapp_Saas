import { NextResponse } from "next/server";
import { saveYoutubeChannel, getChannel } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage, describeChannelSaveError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const mask = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "••••");

// POST — create/update a YouTube channel for the current tenant. The "token" is
// the OAuth refresh token (kept on edit when blank/masked), encrypted at rest.
// YouTube is poll-based (no webhook subscription needed).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  { const gate = await guardFeature(tenantId, "ch_youtube"); if (gate) return gate; }
  let body: { id?: string; name?: string; ytChannelId?: string; token?: string; agentId?: string | null; kbTag?: string | null; commentAi?: boolean; active?: boolean; isDefault?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.ytChannelId?.trim()) {
    return NextResponse.json({ error: "name and YouTube channel id are required" }, { status: 400 });
  }
  if (!body.id) {
    try { await enforceLimit(tenantId, "channels"); }
    catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }
  }
  try {
    let token = (body.token ?? "").trim();
    if ((!token || token.includes("…")) && body.id) {
      const existing = await getChannel(body.id, tenantId);
      if (!existing) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      token = existing.token;
    }
    if (!token && !body.id) return NextResponse.json({ error: "An OAuth refresh token is required to connect" }, { status: 400 });
    const saved = await saveYoutubeChannel({
      id: body.id, tenantId, name: body.name!, ytChannelId: body.ytChannelId!,
      token: token || null, agentId: body.agentId ?? null, kbTag: body.kbTag ?? null,
      commentAi: body.commentAi, active: body.active, isDefault: body.isDefault,
    });
    logActivity(await currentUser(), "channel.save", `${saved.name} (YouTube ${saved.ytChannelId})`);
    return NextResponse.json({ success: true, channel: { ...saved, token: mask(saved.token) } });
  } catch (err) {
    return NextResponse.json({ error: describeChannelSaveError(err, "migration 0093_youtube_comments.sql") }, { status: 500 });
  }
}
