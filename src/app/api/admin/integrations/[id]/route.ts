import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  getIntegration, updateIntegration, deleteIntegration, isIntegrationEvent,
  WEBHOOK_KINDS, PAYMENT_KINDS, type IntegrationEvent,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";
import { disconnectMezmitra } from "@/lib/mezmitra-link";

export const dynamic = "force-dynamic";

// PATCH — update name / url / events / active (and rotate a CRM token).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let b: { name?: string; url?: string; token?: string; webhookSecret?: string; events?: string[]; active?: boolean; defaultOutletId?: string | null };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const existing = await getIntegration(id, tid);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const patch: Parameters<typeof updateIntegration>[1] = {};
    if (existing.kind === "mezmitra") {
      // The link key, its API key and what it may receive are fixed by the handshake;
      // to change them, disconnect and connect again. Only the default outlet is editable.
      if (b.token !== undefined || b.events !== undefined || b.webhookSecret !== undefined || b.url !== undefined) {
        return NextResponse.json({ error: "Disconnect and connect again to change the Mezvaan link." }, { status: 400 });
      }
      if (b.defaultOutletId !== undefined) {
        if (b.defaultOutletId !== null && !/^[0-9a-f-]{36}$/i.test(b.defaultOutletId)) return NextResponse.json({ error: "Pick an outlet." }, { status: 400 });
        patch.config = { ...existing.config, defaultOutletId: b.defaultOutletId };
      }
    }
    if (b.name !== undefined) patch.name = b.name;
    if (b.active !== undefined) patch.active = b.active;
    if (b.token?.trim()) patch.secret = b.token.trim();   // rotate a CRM API token
    // Payment kinds: set/rotate the provider's inbound webhook signing secret.
    if (b.webhookSecret !== undefined) {
      if (!PAYMENT_KINDS.includes(existing.kind)) return NextResponse.json({ error: "Webhook secret only applies to payment providers." }, { status: 400 });
      if (b.webhookSecret.trim()) patch.webhookSecret = b.webhookSecret.trim();
    }
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
    const existing = await getIntegration(id, tid);
    // Mezvaan: also revoke the API key it holds and tell it to stop, so neither side keeps access.
    if (existing?.kind === "mezmitra") await disconnectMezmitra(tid, existing);
    await deleteIntegration(id, tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
