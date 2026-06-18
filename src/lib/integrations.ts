import { DEFAULT_TENANT_ID } from "./tenant";
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


// ── Event catalog ────────────────────────────────────────────────────────────
// Stable string keys — external automations match on these, so renaming one is
// a breaking change for tenants. Add new events to the end.
export const INTEGRATION_EVENTS = [
  "contact.created",
  "message.inbound",
  "conversation.escalated",
  "order.created",
  "contact.optout",
] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export const EVENT_LABELS: Record<IntegrationEvent, string> = {
  "contact.created": "New contact / lead",
  "message.inbound": "New message received",
  "conversation.escalated": "Chat handed to a human",
  "order.created": "Order placed",
  "contact.optout": "Contact opted out",
};

export function isIntegrationEvent(s: string): s is IntegrationEvent {
  return (INTEGRATION_EVENTS as readonly string[]).includes(s);
}

// ── Connector kinds ──────────────────────────────────────────────────────────
// The registry below makes adding a kind a local change.
//   webhook    — signed outbound HTTP (Zapier/Make/Slack/Teams)
//   hubspot    — sync contacts into HubSpot (private-app token)
//   pipedrive  — sync persons into Pipedrive (API token)
//   razorpay   — generate payment links (key id + secret)
//   stripe     — generate payment links (secret key)
export type IntegrationKind = "webhook" | "slack" | "teams" | "hubspot" | "pipedrive" | "razorpay" | "stripe" | "shopify" | "woocommerce" | "calcom";
export type WebhookFormat = "generic" | "slack" | "teams";

// Webhook-style kinds POST to a URL. slack/teams are webhooks with the format
// pre-set, surfaced as their own types so users don't have to know they're "just
// a webhook". The format each one sends is derived from the kind (see formatForKind).
export const WEBHOOK_KINDS: IntegrationKind[] = ["webhook", "slack", "teams"];
export function formatForKind(kind: IntegrationKind): WebhookFormat {
  return kind === "slack" ? "slack" : kind === "teams" ? "teams" : "generic";
}
// CRM kinds authenticate with a single pasted token.
export const CRM_KINDS: IntegrationKind[] = ["hubspot", "pipedrive"];
// Payment kinds expose createPaymentLink() instead of subscribing to events.
export const PAYMENT_KINDS: IntegrationKind[] = ["razorpay", "stripe"];
// Store kinds expose fetchProducts() for one-way catalog import.
export const STORE_KINDS: IntegrationKind[] = ["shopify", "woocommerce"];
// Scheduling kinds back the flow "Book meeting" node (slots + booking via API).
export const SCHEDULE_KINDS: IntegrationKind[] = ["calcom"];
// Event-driven kinds — their `events` subscription matters; action kinds ignore it.
export const EVENT_KINDS: IntegrationKind[] = ["webhook", "slack", "teams", "hubspot", "pipedrive"];
export const KIND_LABELS: Record<IntegrationKind, string> = {
  webhook: "Webhook (Zapier / Make / n8n)",
  slack: "Slack",
  teams: "Microsoft Teams",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  razorpay: "Razorpay",
  stripe: "Stripe",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  calcom: "Cal.com",
};

// A product pulled from an external store, normalized for wa_products import.
export interface ImportedProduct {
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  externalId: string;     // store's product id — dedup key on re-sync
  available: boolean;
}

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
    case "contact.created":
      return `🆕 New lead: ${who}${data.channel ? ` (${String(data.channel)})` : ""}.`;
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

// Split a free-text name into first/last for CRM contact records.
export function splitName(name: string | undefined): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// HubSpot contact properties from an event payload (phone is the dedup key).
export function hubspotContactProps(data: Record<string, unknown>): Record<string, string> {
  const { first, last } = splitName(data.name as string);
  const phone = String(data.phone ?? "").trim();
  const props: Record<string, string> = { phone };
  if (first) props.firstname = first;
  if (last) props.lastname = last;
  props.hs_lead_status = "NEW";
  if (data.channel) props.lifecyclestage = "lead";
  return props;
}

// Pipedrive person body from an event payload.
export function pipedrivePersonBody(data: Record<string, unknown>): Record<string, unknown> {
  const phone = String(data.phone ?? "").trim();
  const name = (data.name as string)?.trim() || phone || "WhatsApp lead";
  return { name, phone: [{ value: phone, primary: true, label: "mobile" }] };
}

// ── Store import helpers (pure) ───────────────────────────────────────────────

// Normalize a Shopify shop to its myshopify.com host: "my-store" →
// "my-store.myshopify.com"; strips any scheme/path the tenant pasted.
export function normalizeShop(input: unknown): string {
  const d = String(input ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!d) return "";
  return d.includes(".") ? d : `${d}.myshopify.com`;
}

// Normalize a WooCommerce store URL to an https origin with no trailing slash.
export function wooBase(input: unknown): string {
  let u = String(input ?? "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/^http:\/\//i, "https://");
}

// Parse a store's decimal price string ("19.99") to integer cents.
export function toCents(price: unknown): number {
  const n = parseFloat(String(price ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function stripHtml(html: unknown): string {
  return String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

export function mapShopifyProduct(p: Record<string, unknown>): ImportedProduct {
  const variants = (p.variants as Record<string, unknown>[]) ?? [];
  const image = p.image as { src?: string } | null | undefined;
  return {
    name: String(p.title ?? "").trim() || "Product",
    description: stripHtml(p.body_html) || null,
    priceCents: toCents(variants[0]?.price),
    currency: "INR",
    imageUrl: image?.src ?? null,
    externalId: String(p.id ?? ""),
    available: p.status === "active",
  };
}

export function mapWooProduct(p: Record<string, unknown>): ImportedProduct {
  const images = (p.images as { src?: string }[]) ?? [];
  return {
    name: String(p.name ?? "").trim() || "Product",
    description: stripHtml(p.description ?? p.short_description) || null,
    priceCents: toCents(p.price),
    currency: "INR",
    imageUrl: images[0]?.src ?? null,
    externalId: String(p.id ?? ""),
    available: p.status === "publish",
  };
}

// ── Scheduling helpers (pure) ─────────────────────────────────────────────────

export interface Slot { id: string; iso: string; label: string }

// Human label for a slot, in the booking timezone (e.g. "Sat 21 Jun, 3:00 PM").
export function formatSlotLabel(iso: string, tz = "Asia/Kolkata"): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", day: "2-digit", month: "short",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(iso)).replace(",", "");
  } catch { return iso; }
}

// Flatten Cal.com's /slots response ({ slots: { date: [{ time }] } }) into a
// sorted, capped list of bookable slots with stable ids (s0, s1, …).
export function parseCalcomSlots(json: unknown, tz = "Asia/Kolkata", limit = 8): Slot[] {
  const bucket = (json as { slots?: Record<string, { time?: string }[]> })?.slots ?? {};
  const isos = Object.values(bucket).flat().map(s => s?.time).filter((t): t is string => !!t);
  const sorted = [...new Set(isos)].sort();
  return sorted.slice(0, limit).map((iso, i) => ({ id: `s${i}`, iso, label: formatSlotLabel(iso, tz) }));
}

// Resolve an inbound reply to a slot id: exact id ("s2") or 1-based position ("3").
export function matchSlot(text: string, ids: string[]): string | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  if (ids.includes(t)) return t;
  if (/^\d{1,2}$/.test(t)) { const n = parseInt(t, 10); if (n >= 1 && n <= ids.length) return ids[n - 1]; }
  return null;
}

// Pull the first email out of free text. Returns null when none looks valid.
export function extractEmail(text: string): string | null {
  const m = (text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
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

export interface PaymentLinkParams {
  amountCents: number;
  currency?: string;       // ISO code; defaults to INR
  description?: string;
  phone?: string;
}

interface Connector {
  verify(i: Integration, secret: string | null): Promise<{ ok: boolean; detail: string }>;
  // Event-driven connectors implement deliver; action connectors (payments) don't.
  deliver?(i: Integration, secret: string | null, envelope: EventEnvelope): Promise<void>;
  // Payment connectors implement this; returns a hosted checkout URL.
  createPaymentLink?(i: Integration, secret: string | null, p: PaymentLinkParams): Promise<{ url: string; id: string }>;
  // Store connectors implement this; returns the catalog for one-way import.
  fetchProducts?(i: Integration, secret: string | null): Promise<ImportedProduct[]>;
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

// ── HubSpot — sync contacts (private-app token) ───────────────────────────────
// deliver() is idempotent: search by phone, create only when absent, so a
// connection subscribed to "every message" never makes duplicate contacts.
const HUBSPOT_API = "https://api.hubapi.com";
const hubspotConnector: Connector = {
  async verify(_i, secret) {
    if (!secret) return { ok: false, detail: "Paste your HubSpot private-app token first." };
    try {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts?limit=1`, {
        headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return { ok: true, detail: "Connected — your HubSpot token works." };
      if (res.status === 401) return { ok: false, detail: "HubSpot rejected the token — create a Private App with crm.objects.contacts read+write and paste its token." };
      if (res.status === 403) return { ok: false, detail: "That HubSpot token is missing the Contacts scope (crm.objects.contacts.read / .write)." };
      return { ok: false, detail: `HubSpot returned HTTP ${res.status}. Check the token and try again.` };
    } catch { return { ok: false, detail: "Couldn't reach HubSpot — check your connection and try again." }; }
  },
  async deliver(_i, secret, envelope) {
    const phone = String(envelope.data.phone ?? "").trim();
    if (!secret || !phone) return;
    const auth = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
    const search = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
      method: "POST", headers: auth, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }], properties: ["phone"], limit: 1 }),
    });
    if (search.ok) {
      const found = (await search.json().catch(() => null)) as { total?: number } | null;
      if (found?.total && found.total > 0) return; // already in HubSpot — no dupe
    }
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts`, {
      method: "POST", headers: auth, signal: AbortSignal.timeout(6000),
      body: JSON.stringify({ properties: hubspotContactProps(envelope.data) }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`HubSpot HTTP ${res.status}`); // 409 = already exists
  },
};

// ── Pipedrive — sync persons (API token) ──────────────────────────────────────
const PIPEDRIVE_API = "https://api.pipedrive.com/v1";
const pipedriveConnector: Connector = {
  async verify(_i, secret) {
    if (!secret) return { ok: false, detail: "Paste your Pipedrive API token first." };
    try {
      const res = await fetch(`${PIPEDRIVE_API}/users/me?api_token=${encodeURIComponent(secret)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your Pipedrive token works." };
      if (res.status === 401) return { ok: false, detail: "Pipedrive rejected the token — copy it from Settings → Personal preferences → API." };
      return { ok: false, detail: `Pipedrive returned HTTP ${res.status}. Check the token and try again.` };
    } catch { return { ok: false, detail: "Couldn't reach Pipedrive — check your connection and try again." }; }
  },
  async deliver(_i, secret, envelope) {
    const phone = String(envelope.data.phone ?? "").trim();
    if (!secret || !phone) return;
    const q = `api_token=${encodeURIComponent(secret)}`;
    const search = await fetch(`${PIPEDRIVE_API}/persons/search?term=${encodeURIComponent(phone)}&fields=phone&exact_match=false&limit=1&${q}`, { signal: AbortSignal.timeout(6000) });
    if (search.ok) {
      const found = (await search.json().catch(() => null)) as { data?: { items?: unknown[] } } | null;
      if (found?.data?.items?.length) return; // already a person — no dupe
    }
    const res = await fetch(`${PIPEDRIVE_API}/persons?${q}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(6000),
      body: JSON.stringify(pipedrivePersonBody(envelope.data)),
    });
    if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}`);
  },
};

// ── Razorpay — hosted payment links (key id + key secret) ─────────────────────
// key_id lives in config (it's semi-public, used as the Basic-auth username);
// key_secret is the encrypted secret. Amount is in the smallest unit (paise for
// INR) == our amountCents, so it passes straight through.
const RAZORPAY_API = "https://api.razorpay.com/v1";
function basicAuth(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}
const razorpayConnector: Connector = {
  async verify(i, secret) {
    const keyId = String(i.config.keyId ?? "").trim();
    if (!keyId || !secret) return { ok: false, detail: "Add both your Razorpay Key ID and Key Secret." };
    try {
      const res = await fetch(`${RAZORPAY_API}/payment_links?count=1`, { headers: { Authorization: basicAuth(keyId, secret) }, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your Razorpay keys work." };
      if (res.status === 401) return { ok: false, detail: "Razorpay rejected the keys — copy the Key ID and Key Secret from Settings → API Keys." };
      return { ok: false, detail: `Razorpay returned HTTP ${res.status}. Check the keys and try again.` };
    } catch { return { ok: false, detail: "Couldn't reach Razorpay — check your connection and try again." }; }
  },
  async createPaymentLink(i, secret, p) {
    const keyId = String(i.config.keyId ?? "").trim();
    if (!keyId || !secret) throw new Error("Razorpay keys missing");
    const res = await fetch(`${RAZORPAY_API}/payment_links`, {
      method: "POST", headers: { Authorization: basicAuth(keyId, secret), "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        amount: Math.round(p.amountCents), currency: (p.currency ?? "INR").toUpperCase(),
        description: (p.description ?? "Payment").slice(0, 2048),
        ...(p.phone ? { customer: { contact: p.phone }, notify: { sms: false, email: false } } : {}),
        reminder_enable: false,
      }),
    });
    if (!res.ok) throw new Error(`Razorpay HTTP ${res.status}`);
    const d = (await res.json()) as { id: string; short_url: string };
    return { url: d.short_url, id: d.id };
  },
};

// ── Stripe — hosted payment links (secret key) ────────────────────────────────
// Stripe payment links need a Price object, so we create an ad-hoc Price for the
// amount, then a Payment Link pointing at it (two form-encoded calls).
const STRIPE_API = "https://api.stripe.com/v1";
const stripeConnector: Connector = {
  async verify(_i, secret) {
    if (!secret) return { ok: false, detail: "Paste your Stripe secret key (starts with sk_) first." };
    try {
      const res = await fetch(`${STRIPE_API}/balance`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your Stripe key works." };
      if (res.status === 401) return { ok: false, detail: "Stripe rejected the key — use your Secret key (sk_live_… or sk_test_…) from Developers → API keys." };
      return { ok: false, detail: `Stripe returned HTTP ${res.status}. Check the key and try again.` };
    } catch { return { ok: false, detail: "Couldn't reach Stripe — check your connection and try again." }; }
  },
  async createPaymentLink(_i, secret, p) {
    if (!secret) throw new Error("Stripe key missing");
    const auth = { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" };
    const priceBody = new URLSearchParams({
      unit_amount: String(Math.round(p.amountCents)),
      currency: (p.currency ?? "INR").toLowerCase(),
      "product_data[name]": (p.description ?? "Payment").slice(0, 250),
    });
    const priceRes = await fetch(`${STRIPE_API}/prices`, { method: "POST", headers: auth, body: priceBody, signal: AbortSignal.timeout(8000) });
    if (!priceRes.ok) throw new Error(`Stripe price HTTP ${priceRes.status}`);
    const price = (await priceRes.json()) as { id: string };
    const linkBody = new URLSearchParams({ "line_items[0][price]": price.id, "line_items[0][quantity]": "1" });
    const linkRes = await fetch(`${STRIPE_API}/payment_links`, { method: "POST", headers: auth, body: linkBody, signal: AbortSignal.timeout(8000) });
    if (!linkRes.ok) throw new Error(`Stripe link HTTP ${linkRes.status}`);
    const link = (await linkRes.json()) as { id: string; url: string };
    return { url: link.url, id: link.id };
  },
};

// ── Shopify — one-way product import (Admin API access token) ─────────────────
// shop domain lives in config; the Admin API access token is the secret. URLs go
// through safeFetch so a pasted host can't point at internal services.
const shopifyConnector: Connector = {
  async verify(i, secret) {
    const shop = normalizeShop(i.config.shopDomain);
    if (!shop || !secret) return { ok: false, detail: "Add your shop domain and Admin API access token." };
    try {
      const res = await safeFetch(`https://${shop}/admin/api/2024-01/shop.json`, { headers: { "X-Shopify-Access-Token": secret }, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your Shopify store is reachable." };
      if (res.status === 401 || res.status === 403) return { ok: false, detail: "Shopify rejected the token — create a custom app with read_products and paste its Admin API access token." };
      return { ok: false, detail: `Shopify returned HTTP ${res.status}. Check the shop domain and token.` };
    } catch { return { ok: false, detail: "Couldn't reach that Shopify store — check the shop domain (e.g. my-store.myshopify.com)." }; }
  },
  async fetchProducts(i, secret) {
    const shop = normalizeShop(i.config.shopDomain);
    if (!shop || !secret) throw new Error("Shopify creds missing");
    const res = await safeFetch(`https://${shop}/admin/api/2024-01/products.json?limit=100`, { headers: { "X-Shopify-Access-Token": secret }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
    const data = (await res.json()) as { products?: Record<string, unknown>[] };
    return (data.products ?? []).map(mapShopifyProduct);
  },
};

// ── WooCommerce — one-way product import (consumer key + secret) ───────────────
const wooConnector: Connector = {
  async verify(i, secret) {
    const base = wooBase(i.config.storeUrl);
    const ck = String(i.config.consumerKey ?? "").trim();
    if (!base || !ck || !secret) return { ok: false, detail: "Add your store URL, consumer key, and consumer secret." };
    try {
      const res = await safeFetch(`${base}/wp-json/wc/v3/products?per_page=1`, { headers: { Authorization: basicAuth(ck, secret) }, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your WooCommerce store is reachable." };
      if (res.status === 401) return { ok: false, detail: "WooCommerce rejected the keys — generate REST API keys (Read access) under WooCommerce → Settings → Advanced → REST API." };
      return { ok: false, detail: `WooCommerce returned HTTP ${res.status}. Check the store URL and keys.` };
    } catch { return { ok: false, detail: "Couldn't reach that store — check the store URL (e.g. https://shop.example.com)." }; }
  },
  async fetchProducts(i, secret) {
    const base = wooBase(i.config.storeUrl);
    const ck = String(i.config.consumerKey ?? "").trim();
    if (!base || !ck || !secret) throw new Error("WooCommerce creds missing");
    const res = await safeFetch(`${base}/wp-json/wc/v3/products?per_page=100`, { headers: { Authorization: basicAuth(ck, secret) }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    return (Array.isArray(rows) ? rows : []).map(mapWooProduct);
  },
};

// ── Cal.com — book meetings from a flow (API key + event type id) ─────────────
// The flow "Book meeting" node uses calcomSlots()/calcomBook() below; the
// connector itself only needs verify() for the Settings "Test" button.
const CALCOM_API = "https://api.cal.com/v1";
const calcomConnector: Connector = {
  async verify(i, secret) {
    if (!secret) return { ok: false, detail: "Paste your Cal.com API key first." };
    if (!String(i.config.eventTypeId ?? "").trim()) return { ok: false, detail: "Add the Event Type ID of the meeting you want customers to book." };
    try {
      const res = await fetch(`${CALCOM_API}/event-types?apiKey=${encodeURIComponent(secret)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return { ok: true, detail: "Connected — your Cal.com key works." };
      if (res.status === 401) return { ok: false, detail: "Cal.com rejected the key — create an API key under Settings → Developer → API Keys." };
      return { ok: false, detail: `Cal.com returned HTTP ${res.status}. Check the key and try again.` };
    } catch { return { ok: false, detail: "Couldn't reach Cal.com — check your connection and try again." }; }
  },
};

const CONNECTORS: Record<IntegrationKind, Connector> = {
  webhook: webhookConnector,
  slack: webhookConnector,   // webhook with format pre-set to "slack"
  teams: webhookConnector,   // webhook with format pre-set to "teams"
  hubspot: hubspotConnector,
  pipedrive: pipedriveConnector,
  razorpay: razorpayConnector,
  stripe: stripeConnector,
  shopify: shopifyConnector,
  woocommerce: wooConnector,
  calcom: calcomConnector,
};

// Resolve the tenant's active integration of any of `kinds` (+ its secret).
async function activeIntegration(tenantId: string, kinds: IntegrationKind[]): Promise<{ integration: Integration; secret: string | null } | null> {
  const all = await listIntegrations(tenantId);
  const i = all.find(x => x.active && kinds.includes(x.kind));
  if (!i) return null;
  return { integration: i, secret: await getSecret(i.id, tenantId) };
}

// Available Cal.com slots for the next `days` days. Returns null when no Cal.com
// integration is configured (so the flow node can skip gracefully); [] when the
// calendar is simply full. Never throws.
export async function calcomSlots(tenantId: string, opts: { days?: number; tz?: string } = {}): Promise<Slot[] | null> {
  try {
    const found = await activeIntegration(tenantId, SCHEDULE_KINDS);
    if (!found?.secret) return null;
    const tz = opts.tz || "Asia/Kolkata";
    const eventTypeId = String(found.integration.config.eventTypeId ?? "").trim();
    if (!eventTypeId) return null;
    const start = new Date().toISOString();
    const end = new Date(Date.now() + (opts.days ?? 5) * 86400_000).toISOString();
    const url = `${CALCOM_API}/slots?apiKey=${encodeURIComponent(found.secret)}&eventTypeId=${encodeURIComponent(eventTypeId)}&startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}&timeZone=${encodeURIComponent(tz)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return parseCalcomSlots(await res.json().catch(() => null), tz);
  } catch (err) {
    console.error("[integrations] calcom slots failed:", errorMessage(err));
    return [];
  }
}

// Book a Cal.com slot for an attendee. Returns true on success. Never throws.
export async function calcomBook(tenantId: string, p: { startIso: string; name: string; email: string; tz?: string }): Promise<boolean> {
  try {
    const found = await activeIntegration(tenantId, SCHEDULE_KINDS);
    if (!found?.secret) return false;
    const eventTypeId = Number(found.integration.config.eventTypeId);
    if (!Number.isFinite(eventTypeId)) return false;
    const res = await fetch(`${CALCOM_API}/bookings?apiKey=${encodeURIComponent(found.secret)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        eventTypeId, start: p.startIso,
        responses: { name: p.name || "WhatsApp lead", email: p.email },
        timeZone: p.tz || "Asia/Kolkata", language: "en", metadata: {},
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[integrations] calcom book failed:", errorMessage(err));
    return false;
  }
}

// Pull a store integration's catalog (one-way). Returns the kind + normalized
// products; the route persists them via commerce.importProducts. Throws on bad
// creds / unreachable store so the route can show a plain-English error.
export async function fetchStoreProducts(integrationId: string, tenantId: string): Promise<{ kind: IntegrationKind; products: ImportedProduct[] }> {
  const i = await getIntegration(integrationId, tenantId);
  if (!i || !STORE_KINDS.includes(i.kind)) throw new Error("Not a store integration");
  const connector = CONNECTORS[i.kind];
  if (!connector?.fetchProducts) throw new Error("This store type can't be imported.");
  const secret = await getSecret(integrationId, tenantId);
  return { kind: i.kind, products: await connector.fetchProducts(i, secret) };
}

// Generate a hosted payment link via the tenant's active payment provider, if
// any. Returns null when no payment integration is configured. Never throws.
export async function createPaymentLink(tenantId: string, p: PaymentLinkParams): Promise<{ url: string; id: string } | null> {
  try {
    const all = await listIntegrations(tenantId);
    const pay = all.find(i => i.active && PAYMENT_KINDS.includes(i.kind));
    if (!pay) return null;
    const connector = CONNECTORS[pay.kind];
    if (!connector?.createPaymentLink) return null;
    const secret = await getSecret(pay.id, tenantId);
    return await connector.createPaymentLink(pay, secret, p);
  } catch (err) {
    console.error("[integrations] payment link failed:", errorMessage(err));
    return null;
  }
}

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
      if (!connector?.deliver) return;
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
