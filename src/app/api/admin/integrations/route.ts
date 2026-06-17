import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  listIntegrations, createIntegration, isIntegrationEvent,
  CRM_KINDS, type IntegrationEvent, type IntegrationKind, type WebhookFormat,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FORMATS: WebhookFormat[] = ["generic", "slack", "teams"];
const KINDS: IntegrationKind[] = ["webhook", "hubspot", "pipedrive"];

// GET — this tenant's integrations (never returns secrets).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ integrations: await listIntegrations(tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — add a connection. Webhooks need a URL + format; CRMs (HubSpot,
// Pipedrive) need an API token. For webhooks the signing secret is returned ONCE
// (never shown again); CRM tokens are never echoed back.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: { kind?: string; name?: string; url?: string; format?: string; token?: string; events?: string[] };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const kind = (KINDS.includes(b.kind as IntegrationKind) ? b.kind : "webhook") as IntegrationKind;
  const events = (Array.isArray(b.events) ? b.events : []).filter(isIntegrationEvent) as IntegrationEvent[];
  if (!events.length) return NextResponse.json({ error: "Pick at least one event to send." }, { status: 400 });

  let config: Record<string, unknown> = {};
  let secretInput: string | undefined;
  if (CRM_KINDS.includes(kind)) {
    secretInput = (b.token ?? "").trim();
    if (!secretInput) return NextResponse.json({ error: "Paste your API token to connect." }, { status: 400 });
  } else {
    const url = (b.url ?? "").trim();
    if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Enter a valid https webhook URL." }, { status: 400 });
    const format = (FORMATS.includes(b.format as WebhookFormat) ? b.format : "generic") as WebhookFormat;
    config = { url, format };
  }

  try {
    const { integration, secret } = await createIntegration(
      { kind, name: (b.name ?? "").trim() || kind, config, events, secret: secretInput },
      tid,
    );
    // Only the auto-generated webhook signing secret is surfaced; never a CRM token.
    return NextResponse.json({ success: true, integration, secret: kind === "webhook" ? secret : null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
