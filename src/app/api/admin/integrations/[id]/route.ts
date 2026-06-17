import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  getIntegration, updateIntegration, deleteIntegration, isIntegrationEvent,
  WEBHOOK_KINDS, type IntegrationEvent,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// PATCH — update name / url / events / active (and rotate a CRM token).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let b: { name?: string; url?: string; token?: string; events?: string[]; active?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const existing = await getIntegration(id, tid);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const patch: Parameters<typeof updateIntegration>[1] = {};
    if (b.name !== undefined) patch.name = b.name;
    if (b.active !== undefined) patch.active = b.active;
    if (b.token?.trim()) patch.secret = b.token.trim();   // rotate a CRM API token
    if (b.events !== undefined) {
      const events = b.events.filter(isIntegrationEvent) as IntegrationEvent[];
      if (!events.length) return NextResponse.json({ error: "Pick at least one event to send." }, { status: 400 });
      patch.events = events;
    }
    if (WEBHOOK_KINDS.includes(existing.kind) && b.url !== undefined) {
      const url = b.url.trim();
      if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Enter a valid https webhook URL." }, { status: 400 });
      patch.config = { ...existing.config, url };   // format stays fixed by kind
    }
    await updateIntegration(id, patch, tid);
    return NextResponse.json({ success: true, integration: await getIntegration(id, tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — remove the connection (stops all delivery to it).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteIntegration(id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
