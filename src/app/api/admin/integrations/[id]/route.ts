import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  getIntegration, updateIntegration, deleteIntegration, isIntegrationEvent,
  type IntegrationEvent, type WebhookFormat,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const FORMATS: WebhookFormat[] = ["generic", "slack", "teams"];

// PATCH — update name / url / format / events / active.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let b: { name?: string; url?: string; format?: string; token?: string; events?: string[]; active?: boolean };
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
    if (existing.kind === "webhook" && (b.url !== undefined || b.format !== undefined)) {
      const url = (b.url ?? String(existing.config.url ?? "")).trim();
      if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Enter a valid https webhook URL." }, { status: 400 });
      const format = (FORMATS.includes(b.format as WebhookFormat) ? b.format : existing.config.format ?? "generic") as WebhookFormat;
      patch.config = { ...existing.config, url, format };
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
