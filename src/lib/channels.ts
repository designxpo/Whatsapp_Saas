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

export interface Channel extends ChannelCreds {
  id: string;
  tenantId: string;
  name: string;
  agentId: string | null;     // default AI persona for conversations on this number
  active: boolean;
  isDefault: boolean;
  createdAt: string;
}

function mapChannel(r: Record<string, unknown>): Channel {
  return {
    id: r.id as string,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    name: r.name as string,
    // Tokens are stored encrypted (crypto.ts); readSecret tolerates legacy plaintext.
    token: readSecret(r.access_token as string) ?? "",
    phoneId: r.phone_number_id as string,
    wabaId: r.waba_id as string,
    appId: (r.app_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    active: (r.active as boolean) ?? true,
    isDefault: (r.is_default as boolean) ?? false,
    createdAt: r.created_at as string,
  };
}

export async function listChannels(): Promise<Channel[]> {
  try {
    const { data, error } = await db().from("wa_channels").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapChannel);
  } catch { return []; }     // table missing → env single-number mode
}

export async function getChannel(id: string): Promise<Channel | null> {
  try {
    const { data } = await db().from("wa_channels").select("*").eq("id", id).maybeSingle();
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

// The channel used when a send doesn't specify one: the explicit default, else
// the first active channel, else null (= env credentials).
export async function getDefaultChannel(): Promise<Channel | null> {
  const all = (await listChannels()).filter(c => c.active);
  return all.find(c => c.isDefault) ?? all[0] ?? null;
}

// Resolve a channel reference (id | Channel | null/undefined) to creds-or-undefined.
// `undefined` tells the senders to use env credentials.
export async function credsFor(ref?: string | Channel | null): Promise<ChannelCreds | undefined> {
  if (!ref) return undefined;
  const c = typeof ref === "string" ? await getChannel(ref) : ref;
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

export async function deleteChannel(id: string): Promise<void> {
  const { error } = await db().from("wa_channels").delete().eq("id", id);
  if (error) throw error;
}
