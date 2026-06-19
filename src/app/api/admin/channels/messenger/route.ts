import { NextResponse } from "next/server";
import { saveMessengerChannel, getChannel } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const mask = (t: string) => (t.length > 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : "••••");

// POST — create/update a Facebook Messenger channel for the current tenant.
// Token kept on edit (blank/masked), encrypted at rest.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string; name?: string; pageId?: string; token?: string; agentId?: string | null; active?: boolean; isDefault?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.pageId?.trim()) {
    return NextResponse.json({ error: "name and Facebook Page id are required" }, { status: 400 });
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
    if (!token) return NextResponse.json({ error: "Page access token is required" }, { status: 400 });
    const saved = await saveMessengerChannel({
      id: body.id, tenantId, name: body.name!, pageId: body.pageId!,
      token, agentId: body.agentId ?? null, active: body.active, isDefault: body.isDefault,
    });
    logActivity(await currentUser(), "channel.save", `${saved.name} (Messenger ${saved.pageId})`);
    return NextResponse.json({ success: true, channel: { ...saved, token: mask(saved.token) } });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0053 is applied` }, { status: 500 });
  }
}
