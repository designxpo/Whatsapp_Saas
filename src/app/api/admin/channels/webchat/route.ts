import { NextResponse } from "next/server";
import { saveWebchatChannel } from "@/lib/channels";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { enforceLimit } from "@/lib/usage";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — create/update a website web-chat channel for the current tenant. The
// public site_key is minted on create and returned so the UI can show the embed
// snippet (it is not a secret — it's meant to live in a public <script> tag).
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: { id?: string; name?: string; allowedOrigins?: string[] | string; agentId?: string | null; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  // Accept origins as an array or a comma/newline-separated string.
  const origins = Array.isArray(body.allowedOrigins)
    ? body.allowedOrigins
    : String(body.allowedOrigins ?? "").split(/[\n,]/);
  if (!body.id) {
    try { await enforceLimit(tenantId, "channels"); }
    catch (e) { return NextResponse.json({ error: errorMessage(e), upgrade: true }, { status: 402 }); }
  }
  try {
    const saved = await saveWebchatChannel({
      id: body.id, tenantId, name: body.name!, allowedOrigins: origins,
      agentId: body.agentId ?? null, active: body.active,
    });
    logActivity(await currentUser(), "channel.save", `web chat: ${saved.name}`);
    return NextResponse.json({ success: true, channel: saved });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0054_webchat_channel.sql is applied` }, { status: 500 });
  }
}
