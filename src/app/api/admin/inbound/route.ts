import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { currentUser, currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { trackingOrigin } from "@/lib/links";
import { errorMessage } from "@/lib/errors";
import { CATALOG_BY_ID, CONNECTABLE } from "@/lib/inbound/catalog";
import { PROVIDERS } from "@/lib/inbound/providers";
import {
  listConnections, getConnectionWithSecrets, saveConnection, setConnectionPaused, deleteConnection,
  recentEvents, newInboundToken, type IntegrationSecrets,
} from "@/lib/inbound/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Incoming events: the tools that send events IN (a store's orders, a gateway's
// payments, a booking page's bookings). Admins only — connecting one decides
// what gets messaged to customers, and the setup details shown here (webhook
// URL, generated secret) are credentials.
//
// What leaves this route: each connection's settings, status, recent events,
// its webhook URL and any secret the portal generated for the business to
// paste into the tool. Never a credential the business typed — only which ones
// are stored.

const origin = (req: Request) => {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return trackingOrigin(host ? `${req.headers.get("x-forwarded-proto") || "https"}://${host}` : null);
};
const webhookUrlFor = (base: string | null, token: string) => (base ? `${base}/api/inbound/${token}` : "");

// Admin of a signed-in workspace, or the response that says why not.
async function adminTenant(): Promise<string | NextResponse> {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  return tid ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const tenantId = await adminTenant();
  if (typeof tenantId !== "string") return tenantId;
  const base = origin(req);
  const rows = await listConnections(tenantId);
  const connections = await Promise.all(rows.map(async row => {
    const full = await getConnectionWithSecrets(tenantId, row.kind).catch(() => null);
    const entry = CATALOG_BY_ID.get(row.kind);
    const secrets = full?.secrets ?? ({ token: "" } as IntegrationSecrets);
    return {
      ...row,
      webhookUrl: secrets.token ? webhookUrlFor(base, secrets.token) : "",
      generated: entry?.generated ? { key: entry.generated.key, value: secrets[entry.generated.key] ?? "" } : null,
      storedSecrets: Object.keys(secrets).filter(k => k !== "token" && k !== entry?.generated?.key && secrets[k]),
      events: await recentEvents(tenantId, row.id, 15),
    };
  }));
  return NextResponse.json({ connections, publicUrl: !!base });
}

// POST { kind, config, secrets } — connect a tool, or change its settings.
export async function POST(req: Request) {
  const tenantId = await adminTenant();
  if (typeof tenantId !== "string") return tenantId;
  let body: { kind?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const kind = String(body.kind ?? "");
  const entry = CATALOG_BY_ID.get(kind);
  const provider = PROVIDERS[kind];
  if (!entry || !provider || !CONNECTABLE.has(kind)) return NextResponse.json({ error: "That integration can't be connected yet." }, { status: 400 });

  const base = origin(req);
  if (!base) return NextResponse.json({ error: "The portal has no public address to give the tool (NEXT_PUBLIC_SITE_URL). Set it, then connect." }, { status: 400 });

  // Only the fields the catalogue declares, so nothing else rides along into
  // the stored config or the encrypted secrets.
  const fields = entry.fields ?? [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "").slice(0, 2000);
  const config: Record<string, string> = {};
  const typed: Record<string, string> = {};
  for (const f of fields) {
    const v = str((f.secret ? body.secrets : body.config)?.[f.key]);
    if (f.secret) { if (v) typed[f.key] = v; } else if (v) config[f.key] = v;
  }

  const existing = await getConnectionWithSecrets(tenantId, kind).catch(() => null);
  const secrets: IntegrationSecrets = { ...(existing?.secrets ?? { token: newInboundToken() }), ...typed };
  if (entry.generated && !secrets[entry.generated.key]) secrets[entry.generated.key] = randomBytes(24).toString("base64url");

  const missing = fields.filter(f => f.required && !(f.secret ? secrets[f.key] : config[f.key])).map(f => f.label);
  if (missing.length) return NextResponse.json({ error: `Missing: ${missing.join(", ")}.` }, { status: 400 });

  // Checked with the tool BEFORE anything is saved: a key that does not work
  // must not replace one that does.
  let detail = "Connected.";
  let finalConfig = { ...(existing?.row.config ?? {}), ...config };
  for (const f of fields) if (!f.secret && !config[f.key]) delete finalConfig[f.key];
  if (provider.connect) {
    const outcome = await provider.connect({ webhookUrl: webhookUrlFor(base, secrets.token), config: finalConfig, secrets });
    if (!outcome.ok) return NextResponse.json({ error: outcome.detail }, { status: 400 });
    detail = outcome.detail;
    finalConfig = { ...finalConfig, ...(outcome.config ?? {}) };
    Object.assign(secrets, outcome.secrets ?? {});
  }

  try {
    const user = await currentUser();
    const connection = await saveConnection({ tenantId, kind, config: finalConfig, secrets, actor: user?.email ?? "", existingId: existing?.row.id ?? null });
    logActivity(user, existing ? "inbound.update" : "inbound.connect", entry.name);
    return NextResponse.json({ success: true, detail, connection, webhookUrl: webhookUrlFor(base, secrets.token) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH { kind, paused } — pause or resume. A paused connection still answers
// the tool with 200, so the tool does not disable its webhook.
export async function PATCH(req: Request) {
  const tenantId = await adminTenant();
  if (typeof tenantId !== "string") return tenantId;
  let body: { kind?: string; paused?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const entry = CATALOG_BY_ID.get(String(body.kind ?? ""));
  if (!entry || typeof body.paused !== "boolean") return NextResponse.json({ error: "kind and paused are required" }, { status: 400 });
  try {
    await setConnectionPaused(tenantId, entry.id, body.paused);
    logActivity(await currentUser(), body.paused ? "inbound.pause" : "inbound.resume", entry.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE ?kind= — disconnect. Whatever the portal set up inside the tool
// (Calendly's subscription) is removed first, best-effort.
export async function DELETE(req: Request) {
  const tenantId = await adminTenant();
  if (typeof tenantId !== "string") return tenantId;
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  const entry = CATALOG_BY_ID.get(kind);
  if (!entry) return NextResponse.json({ error: "Unknown integration" }, { status: 400 });
  try {
    const existing = await getConnectionWithSecrets(tenantId, kind).catch(() => null);
    if (existing) await PROVIDERS[kind]?.disconnect?.(existing.row.config, existing.secrets).catch(() => undefined);
    await deleteConnection(tenantId, kind);
    logActivity(await currentUser(), "inbound.disconnect", entry.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
