import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  listIntegrations, createIntegration, isIntegrationEvent,
  type IntegrationEvent, type WebhookFormat,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FORMATS: WebhookFormat[] = ["generic", "slack", "teams"];

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

// POST — add a webhook connection. Returns the signing secret ONCE (so it can be
// stored on the receiving side); it's never shown again.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: { name?: string; url?: string; format?: string; events?: string[] };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const url = (b.url ?? "").trim();
  if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Enter a valid https webhook URL." }, { status: 400 });
  const format = (FORMATS.includes(b.format as WebhookFormat) ? b.format : "generic") as WebhookFormat;
  const events = (Array.isArray(b.events) ? b.events : []).filter(isIntegrationEvent) as IntegrationEvent[];
  if (!events.length) return NextResponse.json({ error: "Pick at least one event to send." }, { status: 400 });

  try {
    const { integration, secret } = await createIntegration(
      { kind: "webhook", name: (b.name ?? "").trim() || "Webhook", config: { url, format }, events },
      tid,
    );
    return NextResponse.json({ success: true, integration, secret });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
