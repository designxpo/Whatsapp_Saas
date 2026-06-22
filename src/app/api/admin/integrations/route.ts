import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import {
  listIntegrations, createIntegration, isIntegrationEvent,
  CRM_KINDS, PAYMENT_KINDS, STORE_KINDS, SCHEDULE_KINDS, WEBHOOK_KINDS, EVENT_KINDS, formatForKind, type IntegrationEvent, type IntegrationKind,
} from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KINDS: IntegrationKind[] = ["webhook", "slack", "teams", "hubspot", "pipedrive", "leadsquared", "razorpay", "stripe", "shopify", "woocommerce", "calcom"];

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
  let b: { kind?: string; name?: string; url?: string; token?: string; keyId?: string; shopDomain?: string; storeUrl?: string; consumerKey?: string; eventTypeId?: string; events?: string[]; lsqAccessKey?: string; lsqHost?: string; lsqActivityCode?: string; lsqTaskCategory?: string; lsqIgHandleField?: string; lsqAutoCreate?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const kind = (KINDS.includes(b.kind as IntegrationKind) ? b.kind : "webhook") as IntegrationKind;
  const events = (Array.isArray(b.events) ? b.events : []).filter(isIntegrationEvent) as IntegrationEvent[];
  if (EVENT_KINDS.includes(kind) && !events.length) return NextResponse.json({ error: "Pick at least one event to send." }, { status: 400 });

  let config: Record<string, unknown> = {};
  let secretInput: string | undefined;
  if (PAYMENT_KINDS.includes(kind)) {
    secretInput = (b.token ?? "").trim();
    if (!secretInput) return NextResponse.json({ error: kind === "stripe" ? "Paste your Stripe secret key (sk_…)." : "Paste your Razorpay Key Secret." }, { status: 400 });
    if (kind === "razorpay") {
      const keyId = (b.keyId ?? "").trim();
      if (!keyId) return NextResponse.json({ error: "Add your Razorpay Key ID." }, { status: 400 });
      config = { keyId };
    }
  } else if (STORE_KINDS.includes(kind)) {
    secretInput = (b.token ?? "").trim();
    if (kind === "shopify") {
      const shopDomain = (b.shopDomain ?? "").trim();
      if (!shopDomain || !secretInput) return NextResponse.json({ error: "Add your shop domain and Admin API access token." }, { status: 400 });
      config = { shopDomain };
    } else {
      const storeUrl = (b.storeUrl ?? "").trim();
      const consumerKey = (b.consumerKey ?? "").trim();
      if (!storeUrl || !consumerKey || !secretInput) return NextResponse.json({ error: "Add your store URL, consumer key, and consumer secret." }, { status: 400 });
      config = { storeUrl, consumerKey };
    }
  } else if (SCHEDULE_KINDS.includes(kind)) {
    secretInput = (b.token ?? "").trim();
    const eventTypeId = (b.eventTypeId ?? "").trim();
    if (!secretInput || !eventTypeId) return NextResponse.json({ error: "Add your Cal.com API key and the Event Type ID to book." }, { status: 400 });
    config = { eventTypeId };
  } else if (kind === "leadsquared") {
    // Two keys + a few config fields. Both keys are stored together in the
    // encrypted secret; host/activityCode/etc. go in config.
    const accessKey = (b.lsqAccessKey ?? "").trim();
    const secretKey = (b.token ?? "").trim();
    const host = (b.lsqHost ?? "").trim().replace(/\/+$/, "");
    const activityCode = (b.lsqActivityCode ?? "").trim();
    if (!accessKey || !secretKey || !host || !activityCode) return NextResponse.json({ error: "Add your Access Key, Secret Key, API host and Activity code." }, { status: 400 });
    config = { host, activityCode, taskCategory: (b.lsqTaskCategory ?? "").trim() || null, igHandleField: (b.lsqIgHandleField ?? "").trim() || null, autoCreate: !!b.lsqAutoCreate };
    secretInput = JSON.stringify({ accessKey, secretKey });
  } else if (CRM_KINDS.includes(kind)) {
    secretInput = (b.token ?? "").trim();
    if (!secretInput) return NextResponse.json({ error: "Paste your API token to connect." }, { status: 400 });
  } else {
    // Webhook-style (webhook / slack / teams) — a POST URL; format is fixed by kind.
    const url = (b.url ?? "").trim();
    const what = kind === "slack" ? "Slack incoming-webhook" : kind === "teams" ? "Teams incoming-webhook" : "webhook";
    if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: `Enter a valid https ${what} URL.` }, { status: 400 });
    config = { url, format: formatForKind(kind) };
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
