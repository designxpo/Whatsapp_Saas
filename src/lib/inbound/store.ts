// A business's inbound connections: wa_inbound_connections and its event log.
//
// Everything a browser may see comes out of here without secrets. The tool's
// credentials and the connection's inbound token are one encrypted blob; the
// token is found again by its sha256, because the delivery that carries it
// arrives before anybody is signed in. Every query names its tenant: db() is
// the service client here, and the filter is what keeps businesses apart.

import { createHash, randomBytes } from "crypto";
import { db } from "../supabase";
import { encryptSecret, decryptSecret } from "../crypto";

export type ConnectionStatus = "connected" | "paused";

export interface Integration {
  id: string;
  tenantId: string;
  kind: string;
  status: ConnectionStatus;
  config: Record<string, string>;
  lastEventAt: string | null;
  lastEventKey: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  createdBy: string;
}

/** The decrypted half: the inbound token, and the tool's credentials by field key. */
export type IntegrationSecrets = Record<string, string> & { token: string };

export interface InboundEvent {
  id: string;
  eventKey: string;
  outcome: "received" | "processed" | "ignored" | "duplicate" | "failed";
  detail: string | null;
  phoneLast4: string | null;
  createdAt: string;
}

const COLUMNS = "id,tenant_id,kind,status,config,last_event_at,last_event_key,last_error,last_error_at,created_at,created_by";

function mapRow(r: Record<string, unknown>): Integration {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    kind: r.kind as string,
    status: (r.status as ConnectionStatus) ?? "connected",
    config: (r.config as Record<string, string>) ?? {},
    lastEventAt: (r.last_event_at as string | null) ?? null,
    lastEventKey: (r.last_event_key as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    lastErrorAt: (r.last_error_at as string | null) ?? null,
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string) ?? "",
  };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newInboundToken = () => randomBytes(24).toString("base64url");

/** The business's connections. Empty before the migration, rather than an error. */
export async function listConnections(tenantId: string): Promise<Integration[]> {
  const { data, error } = await db().from("wa_inbound_connections").select(COLUMNS).eq("tenant_id", tenantId).order("created_at");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

/** This business's connection to `kind` with its secrets — server-side only. */
export async function getConnectionWithSecrets(tenantId: string, kind: string): Promise<{ row: Integration; secrets: IntegrationSecrets } | null> {
  const { data, error } = await db().from("wa_inbound_connections").select(`${COLUMNS},secret_enc`)
    .eq("tenant_id", tenantId).eq("kind", kind).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { row: mapRow(r), secrets: JSON.parse(decryptSecret(r.secret_enc as string)) as IntegrationSecrets };
}

/** Save a connection with its FINAL, already-verified settings and secrets. */
export async function saveConnection(p: {
  tenantId: string; kind: string; config: Record<string, string>; secrets: IntegrationSecrets; actor: string; existingId?: string | null;
}): Promise<Integration> {
  const row = {
    tenant_id: p.tenantId,
    kind: p.kind,
    config: p.config,
    secret_enc: encryptSecret(JSON.stringify(p.secrets)),
    inbound_token_hash: hashToken(p.secrets.token),
    updated_at: new Date().toISOString(),
    last_error: null, last_error_at: null,
    ...(p.existingId ? {} : { created_by: p.actor, status: "connected" }),
  };
  const q = p.existingId
    ? db().from("wa_inbound_connections").update(row).eq("id", p.existingId).eq("tenant_id", p.tenantId)
    : db().from("wa_inbound_connections").insert(row);
  const { data, error } = await q.select(COLUMNS).single();
  if (error) {
    if (/wa_inbound_connections/.test(error.message) && /exist|schema cache/.test(error.message)) {
      throw new Error("Inbound connections need migration 20261029130000_inbound_connections.sql — apply it in Supabase, then try again.");
    }
    throw new Error(error.message);
  }
  return mapRow(data as Record<string, unknown>);
}

export async function setConnectionPaused(tenantId: string, kind: string, paused: boolean): Promise<void> {
  const { error } = await db().from("wa_inbound_connections")
    .update({ status: paused ? "paused" : "connected", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("kind", kind);
  if (error) throw new Error(error.message);
}

export async function deleteConnection(tenantId: string, kind: string): Promise<void> {
  const { error } = await db().from("wa_inbound_connections").delete().eq("tenant_id", tenantId).eq("kind", kind);
  if (error) throw new Error(error.message);
}

export async function recentEvents(tenantId: string, connectionId: string, limit = 20): Promise<InboundEvent[]> {
  const { data, error } = await db().from("wa_inbound_events")
    .select("id,event_key,outcome,detail,phone_last4,created_at")
    .eq("tenant_id", tenantId).eq("connection_id", connectionId).order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string, eventKey: r.event_key as string, outcome: r.outcome as InboundEvent["outcome"],
    detail: (r.detail as string | null) ?? null, phoneLast4: (r.phone_last4 as string | null) ?? null, createdAt: r.created_at as string,
  }));
}

// ── The inbound path: no session yet, so the token decides the tenant ──────

/** The connection a delivery URL belongs to, with its secrets. */
export async function findByToken(token: string): Promise<{ row: Integration; secrets: IntegrationSecrets } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const { data, error } = await db().from("wa_inbound_connections")
    .select(`${COLUMNS},secret_enc`).eq("inbound_token_hash", hashToken(token)).maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  try {
    return { row: mapRow(r), secrets: JSON.parse(decryptSecret(r.secret_enc as string)) as IntegrationSecrets };
  } catch {
    return null;
  }
}

/**
 * Claim one delivery. Null when this connection already acted on it — every
 * tool retries, and a retried order must not send its confirmation twice. A
 * delivery that FAILED may run again (that is what the retry is for); the
 * conditional update means two racing retries cannot both take it.
 */
export async function claimEvent(i: Integration, e: { externalId: string | null; eventKey: string; phone: string }): Promise<string | null> {
  const { data, error } = await db().from("wa_inbound_events").insert({
    tenant_id: i.tenantId, connection_id: i.id, external_id: e.externalId, event_key: e.eventKey,
    outcome: "received", phone_last4: e.phone ? e.phone.slice(-4) : null,
  }).select("id").single();
  if (error) {
    if ((error as { code?: string }).code !== "23505") throw new Error(error.message);
    const { data: again } = await db().from("wa_inbound_events")
      .update({ outcome: "received", detail: null })
      .eq("tenant_id", i.tenantId).eq("connection_id", i.id).eq("external_id", e.externalId ?? "").eq("outcome", "failed")
      .select("id");
    return ((again ?? []) as { id: string }[])[0]?.id ?? null;
  }
  return (data as { id: string }).id;
}

export async function settleEvent(tenantId: string, eventId: string, outcome: InboundEvent["outcome"], detail: string): Promise<void> {
  await db().from("wa_inbound_events").update({ outcome, detail: detail.slice(0, 500) }).eq("tenant_id", tenantId).eq("id", eventId);
}

export async function noteActivity(i: Integration, p: { eventKey?: string; error?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = p.error
    ? { last_error: p.error.slice(0, 500), last_error_at: now }
    : { last_event_at: now, last_event_key: p.eventKey ?? null, last_error: null, last_error_at: null };
  await db().from("wa_inbound_connections").update(patch).eq("id", i.id).eq("tenant_id", i.tenantId);
}
