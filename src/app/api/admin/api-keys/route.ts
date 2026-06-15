import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listApiKeys, createApiKey, revokeApiKey } from "@/lib/apikeys";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — list this tenant's API keys (prefixes only, never the full key).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    return NextResponse.json({ keys: await listApiKeys(tid) });
  } catch (err) { return NextResponse.json({ keys: [], error: errorMessage(err) }); }
}

// POST { name } — mint a new key. Returns the full key ONCE.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { name?: string };
  try { body = await req.json(); } catch { body = {}; }
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const { key, row } = await createApiKey(tid, body.name ?? "API key");
    logActivity(await currentUser(), "apikey.create", row.prefix);
    return NextResponse.json({ key, row });
  } catch (err) { return NextResponse.json({ error: `${errorMessage(err)} — is migration 0030 applied?` }, { status: 500 }); }
}

// DELETE { id } — revoke a key.
export async function DELETE(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    await revokeApiKey(body.id, tid);
    logActivity(await currentUser(), "apikey.revoke", body.id);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
