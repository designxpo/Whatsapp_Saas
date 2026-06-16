// Multi-number / multi-WABA channels. Every sender accepts an optional
// ChannelCreds; when omitted (or when wa_channels is empty / migration 0013
// not applied) the META_WA_* env credentials are used — so single-number
// setups keep working with zero configuration.

import { db } from "./supabase";
import { encryptSecret, readSecret } from "./crypto";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export interface ChannelCreds {
  token: string;
  phoneId: string;
  wabaId: string;
  appId?: string | null;
}

export type ChannelKind = "whatsapp" | "instagram";

export interface Channel extends ChannelCreds {
  id: string;
  tenantId: string;
  kind: ChannelKind;
  name: string;
  igUserId: string | null;    // IG professional account id (Messaging API), null for WA
  pageId: string | null;      // connected Facebook Page id (IG)
  agentId: string | null;     // default AI persona for conversations on this number
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  // Meta health — drives auto-pause so a degraded number stops broadcasting.
  qualityRating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | null;
  messagingHealth: string | null;   // AVAILABLE | FLAGGED | RESTRICTED
  marketingPaused: boolean;
}

function mapChannel(r: Record<string, unknown>): Channel {
  return {
    id: r.id as string,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    kind: ((r.kind as ChannelKind) ?? "whatsapp"),
    name: r.name as string,
    // Tokens are stored encrypted (crypto.ts); readSecret tolerates legacy plaintext.
    token: readSecret(r.access_token as string) ?? "",
    phoneId: (r.phone_number_id as string) ?? "",
    wabaId: (r.waba_id as string) ?? "",
    igUserId: (r.ig_user_id as string | null) ?? null,
    pageId: (r.page_id as string | null) ?? null,
    appId: (r.app_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    active: (r.active as boolean) ?? true,
    isDefault: (r.is_default as boolean) ?? false,
    createdAt: r.created_at as string,
    qualityRating: (r.quality_rating as Channel["qualityRating"]) ?? null,
    messagingHealth: (r.messaging_health as string | null) ?? null,
    marketingPaused: (r.marketing_paused as boolean) ?? false,
  };
}

// True when this channel is safe to send MARKETING on. A RED quality rating or a
// FLAGGED/RESTRICTED messaging health (or an explicit pause) means Meta is about
// to restrict the number — continuing to broadcast is what gets it disabled.
export function isMarketingSendable(c: Pick<Channel, "qualityRating" | "messagingHealth" | "marketingPaused">): boolean {
  if (c.marketingPaused) return false;
  if (c.qualityRating === "RED") return false;
  if (c.messagingHealth === "FLAGGED" || c.messagingHealth === "RESTRICTED") return false;
  return true;
}

// Persist a quality/health signal (from the Meta webhook or a Graph API poll) and
// auto-pause marketing when it indicates trouble. Matches channels by WABA id
// (the webhook entry.id) and/or phone_number_id. Best-effort: never throws.
export async function recordChannelQuality(match: { wabaId?: string | null; phoneNumberId?: string | null }, signal: { rating?: string | null; health?: string | null; event?: string | null }): Promise<void> {
  const rating = signal.rating ? signal.rating.toUpperCase() : null;
  const health = signal.health ? signal.health.toUpperCase() : null;
  // Derive auto-pause: pause when RED or FLAGGED/RESTRICTED; clear when explicitly healthy.
  const bad = rating === "RED" || health === "FLAGGED" || health === "RESTRICTED" || signal.event === "FLAGGED";
  const healthy = rating === "GREEN" || health === "AVAILABLE" || signal.event === "UNFLAGGED";
  const patch: Record<string, unknown> = { quality_updated_at: new Date().toISOString() };
  if (rating) patch.quality_rating = rating;
  if (health) patch.messaging_health = health;
  if (signal.event) patch.quality_event = signal.event;
  if (bad) patch.marketing_paused = true;
  else if (healthy) patch.marketing_paused = false;
  try {
    let q = db().from("wa_channels").update(patch);
    if (match.phoneNumberId) q = q.eq("phone_number_id", match.phoneNumberId);
    else if (match.wabaId) q = q.eq("waba_id", match.wabaId);
    else return;
    await q;
  } catch (e) { console.error("[channels] recordChannelQuality", e); }
}

export async function listChannels(tenantId?: string): Promise<Channel[]> {
  try {
    let q = db().from("wa_channels").select("*").order("created_at", { ascending: true });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapChannel);
  } catch { return []; }     // table missing → env single-number mode
}

// When tenantId is supplied the lookup is tenant-scoped. ALWAYS pass it from any
// route that takes a client-supplied channel id, or a tenant can use another
// tenant's decrypted credentials (cross-tenant send / credential exposure).
export async function getChannel(id: string, tenantId?: string): Promise<Channel | null> {
  try {
    let q = db().from("wa_channels").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q.maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound routing: Meta puts the receiving number's phone_number_id in every webhook.
export async function getChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | null> {
  if (!phoneNumberId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound IG routing: the webhook entry id is the IG professional account id.
export async function getChannelByIgId(igUserId: string): Promise<Channel | null> {
  if (!igUserId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("ig_user_id", igUserId).maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// The channel used when a send doesn't specify one: the explicit default, else
// the first active channel, else null (= env credentials). Pass tenantId to
// avoid falling back to another tenant's channel.
export async function getDefaultChannel(tenantId?: string): Promise<Channel | null> {
  const all = (await listChannels(tenantId)).filter(c => c.active);
  return all.find(c => c.isDefault) ?? all[0] ?? null;
}

// Resolve a channel reference (id | Channel | null/undefined) to creds-or-undefined.
// `undefined` tells the senders to use env credentials. When ref is a client-
// supplied id, pass tenantId so a foreign channel resolves to undefined rather
// than leaking another tenant's credentials.
export async function credsFor(ref?: string | Channel | null, tenantId?: string): Promise<ChannelCreds | undefined> {
  if (!ref) return undefined;
  const c = typeof ref === "string" ? await getChannel(ref, tenantId) : ref;
  return c ?? undefined;
}

export async function saveChannel(input: Partial<Channel> & { name: string; phoneId: string; wabaId: string; token: string; tenantId?: string }): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row = {
    tenant_id: tenantId,
    name: input.name.trim(),
    phone_number_id: input.phoneId.trim(),
    waba_id: input.wabaId.trim(),
    access_token: encryptSecret(input.token.trim()),   // encrypted at rest
    app_id: input.appId?.trim() || null,
    agent_id: input.agentId || null,
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  // Only one default at a time, per tenant.
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const q = input.id
    ? db().from("wa_channels").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

// Save an Instagram channel (no phone/WABA; IG account id + page instead).
// Token is encrypted at rest and the row is scoped to the tenant.
export async function saveInstagramChannel(input: {
  id?: string; tenantId?: string; name: string; igUserId: string; pageId?: string | null;
  token: string; agentId?: string | null; active?: boolean; isDefault?: boolean;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row = {
    tenant_id: tenantId,
    kind: "instagram",
    name: input.name.trim(),
    ig_user_id: input.igUserId.trim(),
    page_id: input.pageId?.trim() || null,
    access_token: encryptSecret(input.token.trim()),
    agent_id: input.agentId || null,
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const q = input.id
    ? db().from("wa_channels").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

export async function deleteChannel(id: string, tenantId?: string): Promise<void> {
  let q = db().from("wa_channels").delete().eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { error } = await q;
  if (error) throw error;
}
