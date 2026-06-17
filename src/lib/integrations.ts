// Integrations framework — per-tenant outbound connections to external systems.
//
// One shared spine for every connector a tenant adds in their own portal:
//   encrypted creds  →  resolve  →  live verify  →  fan-out on platform events.
//
// The first connector is the UNIVERSAL one: a signed outbound webhook that any
// no-code tool consumes (Zapier / Make / Pabbly / n8n) plus Slack/Teams via
// their incoming-webhook URL. Future connectors (Sheets, HubSpot, Shopify,
// Calendly…) register here too and reuse the same store, verify, and event bus.
//
// Isolation: every read/write is tenant-scoped (tdb); delivery is best-effort
// and isolated per row, so one tenant's broken endpoint can never affect another
// tenant — or even block message delivery for the same tenant (see emitEvent).

import { createHmac, randomBytes, randomUUID } from "crypto";
import { tdb } from "./tenantdb";
import { encryptSecret, readSecret } from "./crypto";
import { safeFetch } from "./ssrf";
import { errorMessage } from "./errors";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ── Event catalog ────────────────────────────────────────────────────────────
// Stable string keys — external automations match on these, so renaming one is
// a breaking change for tenants. Add new events to the end.
export const INTEGRATION_EVENTS = [
  "message.inbound",
  "conversation.escalated",
  "order.created",
  "contact.optout",
] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export const EVENT_LABELS: Record<IntegrationEvent, string> = {
  "message.inbound": "New message received",
  "conversation.escalated": "Chat handed to a human",
  "order.created": "Order placed",
  "contact.optout": "Contact opted out",
};

export function isIntegrationEvent(s: string): s is IntegrationEvent {
  return (INTEGRATION_EVENTS as readonly string[]).includes(s);
}

// ── Connector kinds ──────────────────────────────────────────────────────────
// Only "webhook" today; the registry below makes adding kinds a local change.
export type IntegrationKind = "webhook";
export type WebhookFormat = "generic" | "slack" | "teams";

export interface Integration {
  id: string;
  kind: IntegrationKind;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
  events: IntegrationEvent[];
  status: "connected" | "error" | "unverified";
  statusDetail: string | null;
  hasSecret: boolean;
  lastEventAt: string | null;
  createdAt: string;
}

// The delivery envelope every outbound webhook receives (generic format).
export interface EventEnvelope {
  id: string;
  event: IntegrationEvent;
  occurredAt: string;
  tenant: string;
  data: Record<string, unknown>;
}

// ── Pure helpers (no DB / no network) — unit-tested directly ──────────────────

// HMAC-SHA256 of the exact request body, so the receiver can confirm it really
// came from us (and wasn't tampered with). Returned as "sha256=<hex>".
export function signPayload(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

// One-line human summary for chat destinations (Slack/Teams show this verbatim).
export function humanText(event: IntegrationEvent, data: Record<string, unknown>): string {
  const who = (data.name as string)?.trim() || (data.phone as string) || "a contact";
  switch (event) {
    case "message.inbound":
      return `📩 ${who}: ${String(data.text ?? "").slice(0, 300) || "(no text)"}`;
    case "conversation.escalated":
      return `🙋 Chat with ${who} needs a human${data.reason ? ` — ${String(data.reason).slice(0, 200)}` : ""}.`;
    case "order.created":
      return `🛒 New order ${data.orderId ?? ""} from ${who}.`;
    case "contact.optout":
      return `🚫 ${who} opted out${data.reason ? ` (${String(data.reason)})` : ""}.`;
  }
}

// Build the exact HTTP request for a webhook delivery (pure: body + headers).
// generic → the full JSON envelope, signed. slack/teams → their {text} shape.
export function buildWebhookRequest(opts: {
  format: WebhookFormat;
  secret: string | null;
  envelope: EventEnvelope;
}): { body: string; headers: Record<string, string> } {
  const { format, secret, envelope } = opts;
  const body =
    format === "generic"
      ? JSON.stringify(envelope)
      : JSON.stringify({ text: humanText(envelope.event, envelope.data) });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "AlabsConnect-Webhooks/1.0",
    "X-Alabs-Event": envelope.event,
    "X-Alabs-Delivery": envelope.id,
  };
  // Slack/Teams ignore custom headers; we still sign generic deliveries.
  if (secret && format === "generic") headers["X-Alabs-Signature"] = signPayload(secret, body);
  return { body, headers };
}

// ── DB layer (tenant-scoped) ──────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): Integration {
  const events = ((r.events as string[]) ?? []).filter(isIntegrationEvent);
  return {
    id: r.id as string,
    kind: (r.kind as IntegrationKind) ?? "webhook",
    name: (r.name as string) ?? "",
    active: (r.active as boolean) ?? true,
    config: (r.config as Record<string, unknown>) ?? {},
    events,
    status: (r.status as Integration["status"]) ?? "unverified",
    statusDetail: (r.status_detail as string | null) ?? null,
    hasSecret: !!(r.secret as string | null),
    lastEventAt: (r.last_event_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function listIntegrations(tenantId: string = DEFAULT_TENANT_ID): Promise<Integration[]> {
  const { data } = await tdb(tenantId).from("wa_integrations").select("*").order("created_at", { ascending: false });
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapRow);
}

export async function getIntegration(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Integration | null> {
  const { data } = await tdb(tenantId).from("wa_integrations").select("*").eq("id", id).maybeSingle();
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}

// Read + decrypt the stored secret for a connection (never leaves the server).
async function getSecret(id: string, tenantId: string): Promise<string | null> {
  const { data } = await tdb(tenantId).from("wa_integrations").select("secret").eq("id", id).maybeSingle();
  return readSecret((data as { secret?: string } | null)?.secret ?? null);
}

export interface IntegrationInput {
  kind: IntegrationKind;
  name: string;
  config: Record<string, unknown>;
  events: IntegrationEvent[];
  secret?: string;   // optional explicit secret; webhooks auto-generate one
  active?: boolean;
}

// Create a connection. For webhooks we auto-generate a signing secret so the
// tenant can verify deliveries without inventing one. Returns { integration,
// secret } — the plaintext secret is shown ONCE so they can paste it server-side.
export async function createIntegration(
  input: IntegrationInput,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<{ integration: Integration; secret: string | null }> {
  const secret = input.secret?.trim() || (input.kind === "webhook" ? randomBytes(24).toString("hex") : null);
  const { data, error } = await tdb(tenantId).from("wa_integrations").insert({
    kind: input.kind,
    name: input.name.trim() || input.kind,
    active: input.active ?? true,
    config: input.config ?? {},
    events: input.events,
    secret: secret ? encryptSecret(secret) : null,
    status: "unverified",
  }).select("*").single();
  if (error) throw error;
  return { integration: mapRow(data as Record<string, unknown>), secret };
}

export async function updateIntegration(
  id: string,
  patch: Partial<{ name: string; config: Record<string, unknown>; events: IntegrationEvent[]; active: boolean; secret: string }>,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<void> {
  const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.config !== undefined) values.config = patch.config;
  if (patch.events !== undefined) values.events = patch.events;
  if (patch.active !== undefined) values.active = patch.active;
  if (patch.secret?.trim()) values.secret = encryptSecret(patch.secret.trim());
  const { error } = await tdb(tenantId).from("wa_integrations").update(values).eq("id", id);
  if (error) throw error;
}

export async function deleteIntegration(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await tdb(tenantId).from("wa_integrations").delete().eq("id", id);
  if (error) throw error;
}

async function setStatus(id: string, tenantId: string, status: Integration["status"], detail: string | null, stamp = false): Promise<void> {
  const values: Record<string, unknown> = { status, status_detail: detail, updated_at: new Date().toISOString() };
  if (stamp) values.last_event_at = new Date().toISOString();
  await tdb(tenantId).from("wa_integrations").update(values).eq("id", id).then(() => {}, () => {});
}

// ── Connector registry ────────────────────────────────────────────────────────
// Each kind knows how to verify connectivity and deliver one event. Adding a
// connector = one entry here + (optionally) its own config/secret fields.

interface Connector {
  verify(i: Integration, secret: string | null): Promise<{ ok: boolean; detail: string }>;
  deliver(i: Integration, secret: string | null, envelope: EventEnvelope): Promise<void>;
}

const PING: EventEnvelope = {
  id: "ping",
  event: "message.inbound",
  occurredAt: "",
  tenant: "",
  data: { name: "Alabs Connect", phone: "", text: "✅ Test ping — your webhook is connected." },
};

const webhookConnector: Connector = {
  async verify(i, secret) {
    const url = String(i.config.url ?? "").trim();
    if (!url) return { ok: false, detail: "Add the webhook URL first." };
    const format = (i.config.format as WebhookFormat) ?? "generic";
    const envelope: EventEnvelope = { ...PING, id: randomUUID(), occurredAt: new Date().toISOString() };
    const { body, headers } = buildWebhookRequest({ format, secret, envelope });
    try {
      const res = await safeFetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — we sent a test ping and your endpoint accepted it." };
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "Your endpoint rejected the request (auth). Check the URL or any required token." };
      if (res.status === 404) return { ok: false, detail: "That URL returned 404 — double-check you pasted the full webhook URL." };
      return { ok: false, detail: `Your endpoint returned HTTP ${res.status}. It must respond with a 2xx to accept events.` };
    } catch (err) {
      const m = errorMessage(err);
      if (/private|reserved|not allowed|resolve/i.test(m)) return { ok: false, detail: "That URL isn't reachable from the internet — use a public https URL (not localhost or an internal address)." };
      if (/timeout|aborted/i.test(m)) return { ok: false, detail: "Your endpoint didn't respond in time — make sure it replies quickly with a 2xx." };
      return { ok: false, detail: "Couldn't reach that URL — check it's correct and publicly accessible." };
    }
  },
  async deliver(i, secret, envelope) {
    const url = String(i.config.url ?? "").trim();
    if (!url) throw new Error("no url");
    const format = (i.config.format as WebhookFormat) ?? "generic";
    const { body, headers } = buildWebhookRequest({ format, secret, envelope });
    const res = await safeFetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
};

const CONNECTORS: Record<IntegrationKind, Connector> = { webhook: webhookConnector };

// ── Public: verify + emit ─────────────────────────────────────────────────────

// Run a connector's live connectivity check and persist the result. Used by the
// Settings "Test" button and the setup wizard.
export async function verifyIntegration(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<{ ok: boolean; detail: string }> {
  const i = await getIntegration(id, tenantId);
  if (!i) return { ok: false, detail: "Integration not found." };
  const connector = CONNECTORS[i.kind];
  if (!connector) return { ok: false, detail: "That integration type isn't supported." };
  const secret = await getSecret(id, tenantId);
  const result = await connector.verify(i, secret);
  await setStatus(id, tenantId, result.ok ? "connected" : "error", result.detail);
  return result;
}

// Fan an event out to every active integration subscribed to it. NEVER throws
// and NEVER blocks the caller's important work — wrap the call in `after(() =>
// emitEvent(...))` (or `void emitEvent(...)`). Deliveries run concurrently and
// are isolated: one slow/broken endpoint can't delay or fail the others.
export async function emitEvent(
  tenantId: string,
  event: IntegrationEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const all = await listIntegrations(tenantId);
    const targets = all.filter(i => i.active && i.events.includes(event));
    if (!targets.length) return;
    const envelope: EventEnvelope = { id: randomUUID(), event, occurredAt: new Date().toISOString(), tenant: tenantId, data };
    await Promise.allSettled(targets.map(async i => {
      const connector = CONNECTORS[i.kind];
      if (!connector) return;
      try {
        const secret = await getSecret(i.id, tenantId);
        await connector.deliver(i, secret, envelope);
        // Only write on recovery; always stamp last_event_at (cheap visibility).
        await setStatus(i.id, tenantId, "connected", i.status === "connected" ? i.statusDetail : null, true);
      } catch (err) {
        await setStatus(i.id, tenantId, "error", `Last delivery failed: ${errorMessage(err)}`.slice(0, 300), true);
      }
    }));
  } catch (err) {
    console.error("[integrations] emit failed:", errorMessage(err));
  }
}

// DB-only rollup for the platform-owner health view (no network). Returns the
// count of active integrations and how many are currently in an error state.
export async function integrationsHealth(tenantId: string): Promise<{ total: number; active: number; errored: number }> {
  const all = await listIntegrations(tenantId).catch(() => [] as Integration[]);
  const active = all.filter(i => i.active);
  return { total: all.length, active: active.length, errored: active.filter(i => i.status === "error").length };
}
