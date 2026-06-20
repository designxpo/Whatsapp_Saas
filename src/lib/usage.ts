import { DEFAULT_TENANT_ID } from "./tenant";
// Usage metering + plan-limit enforcement. Resolves a tenant's plan limits and
// current consumption, and gates actions that would exceed them. A limit of 0
// means unlimited. The platform owner's default tenant is always unlimited.

import { db } from "./supabase";
import { getTenant } from "./tenants";
import { getPlan, type PlanLimits } from "./plans";

export type Resource = "contacts" | "conversations" | "messages" | "channels" | "seats";
const UNLIMITED: PlanLimits = { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 0, team_seats: 0 };

export interface Usage { contacts: number; conversations: number; messages: number; channels: number; seats: number }

function monthStartISO(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getPlanLimits(tenantId: string): Promise<PlanLimits> {
  if (tenantId === DEFAULT_TENANT_ID) return UNLIMITED;   // owner's own workspace
  try {
    const t = await getTenant(tenantId);
    const plan = t ? await getPlan(t.plan) : null;
    return plan?.limits ?? UNLIMITED;
  } catch { return UNLIMITED; }
}

export async function getTenantUsage(tenantId: string): Promise<Usage> {
  const since = monthStartISO();
  const [contacts, sendLog, convOut, channels, seats, convCount] = await Promise.all([
    db().from("contacts").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db().from("wa_send_log").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("sent_at", since).in("status", ["sent", "delivered", "read"]),
    db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", since).in("source", ["bot", "agent"]),
    db().from("wa_channels").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db().from("wa_users").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    // Billing unit: distinct conversations with any message this month (RPC from 0059).
    db().rpc("tenant_active_conversations", { p_tenant: tenantId, p_since: since }),
  ]);
  return {
    contacts: contacts.count ?? 0,
    conversations: (convCount.data as number | null) ?? 0,
    messages: (sendLog.count ?? 0) + (convOut.count ?? 0),
    channels: channels.count ?? 0,
    seats: seats.count ?? 0,
  };
}

const LIMIT_KEY: Record<Resource, keyof PlanLimits> = {
  contacts: "contacts", conversations: "conversations_per_month", messages: "messages_per_month", channels: "channels", seats: "team_seats",
};
const USAGE_KEY: Record<Resource, keyof Usage> = {
  contacts: "contacts", conversations: "conversations", messages: "messages", channels: "channels", seats: "seats",
};

export interface LimitCheck { allowed: boolean; used: number; limit: number; resource: Resource }

// True/false plus context. `increment` = how many you're about to add.
export async function checkLimit(tenantId: string, resource: Resource, increment = 1): Promise<LimitCheck> {
  if (tenantId === DEFAULT_TENANT_ID) return { allowed: true, used: 0, limit: 0, resource };
  const [limits, usage] = await Promise.all([getPlanLimits(tenantId), getTenantUsage(tenantId)]);
  const limit = limits[LIMIT_KEY[resource]] ?? 0;
  const used = usage[USAGE_KEY[resource]] ?? 0;
  if (limit <= 0) return { allowed: true, used, limit: 0, resource };   // unlimited
  return { allowed: used + increment <= limit, used, limit, resource };
}

const LABEL: Record<Resource, string> = { contacts: "contacts", conversations: "monthly conversations", messages: "monthly messages", channels: "channels", seats: "team seats" };

// Throws an upgrade-required error when the action would exceed the plan.
export async function enforceLimit(tenantId: string, resource: Resource, increment = 1): Promise<void> {
  const c = await checkLimit(tenantId, resource, increment);
  if (!c.allowed) {
    throw new Error(`You've reached your plan's ${LABEL[resource]} limit (${c.used}/${c.limit}). Upgrade your plan to add more.`);
  }
}
