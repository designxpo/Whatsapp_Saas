// Growth tools — ref links / QR / on-site widgets / opt-in landings. Each has a
// public slug; visiting /g/<slug> redirects to WhatsApp/Instagram with a
// prefilled opt-in message and counts the click. When the user then messages,
// the inbound's prefill text maps back here to apply the action (start a flow,
// enroll a sequence, tag the contact) and count the conversion.

import { db } from "./supabase";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export type GrowthKind = "ref_link" | "qr" | "widget_popup" | "widget_bar" | "landing";

export interface GrowthTool {
  id: string; name: string; kind: GrowthKind; slug: string;
  channelId: string | null; prefill: string | null;
  flowId: string | null; sequenceId: string | null; tag: string | null;
  config: Record<string, unknown>; clicks: number; conversions: number; active: boolean;
  tenantId: string;
}

function mapTool(r: Record<string, unknown>): GrowthTool {
  return {
    id: r.id as string, name: r.name as string, kind: r.kind as GrowthKind, slug: r.slug as string,
    channelId: (r.channel_id as string | null) ?? null, prefill: (r.prefill as string | null) ?? null,
    flowId: (r.flow_id as string | null) ?? null, sequenceId: (r.sequence_id as string | null) ?? null,
    tag: (r.tag as string | null) ?? null, config: (r.config as Record<string, unknown>) ?? {},
    clicks: (r.clicks as number) ?? 0, conversions: (r.conversions as number) ?? 0, active: (r.active as boolean) ?? true,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
  };
}

export async function listGrowthTools(tenantId = DEFAULT_TENANT_ID): Promise<GrowthTool[]> {
  const { data } = await db().from("wa_growth_tools").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapTool(r as Record<string, unknown>));
}

export async function saveGrowthTool(p: Partial<GrowthTool> & { name: string; kind: GrowthKind; slug: string }, tenantId = DEFAULT_TENANT_ID): Promise<GrowthTool> {
  const row = {
    tenant_id: tenantId,
    name: p.name.trim(), kind: p.kind, slug: p.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    channel_id: p.channelId ?? null, prefill: p.prefill ?? null, flow_id: p.flowId ?? null,
    sequence_id: p.sequenceId ?? null, tag: p.tag ?? null, config: p.config ?? {}, active: p.active ?? true,
  };
  const q = p.id ? db().from("wa_growth_tools").update(row).eq("tenant_id", tenantId).eq("id", p.id).select().single()
                 : db().from("wa_growth_tools").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapTool(data as Record<string, unknown>);
}

export async function deleteGrowthTool(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_growth_tools").delete().eq("tenant_id", tenantId).eq("id", id);
}

// Build the redirect target for a slug + count the click. Destination comes from
// config.url (explicit), else a wa.me link from config.number + prefill.
// Public /g/<slug> has no tenant context. Slugs are unique per tenant (0027),
// so a bare slug could match two tenants — take the most recent active match.
// (Tenant-subdomain routing for /g/ would disambiguate; tracked for later.)
export async function resolveGrowthRedirect(slug: string): Promise<string | null> {
  const { data } = await db().from("wa_growth_tools").select("*").eq("slug", slug).eq("active", true).order("created_at", { ascending: false }).limit(1);
  const row = (data ?? [])[0];
  if (!row) return null;
  const tool = mapTool(row as Record<string, unknown>);
  // increment clicks (best-effort, non-blocking semantics)
  await db().from("wa_growth_tools").update({ clicks: tool.clicks + 1 }).eq("id", tool.id);

  const cfg = tool.config as { url?: string; number?: string; igUsername?: string };
  if (cfg.url) return cfg.url;
  const text = tool.prefill ? `?text=${encodeURIComponent(tool.prefill)}` : "";
  if (cfg.number) return `https://wa.me/${cfg.number.replace(/\D/g, "")}${text}`;
  if (cfg.igUsername) return `https://ig.me/m/${cfg.igUsername.replace(/^@/, "")}`;
  return null;
}

// Match an inbound opt-in message back to its growth tool (by prefill text), so
// the webhook can apply the action + count the conversion. Returns the tool.
export async function growthToolForOptIn(text: string, tenantId = DEFAULT_TENANT_ID): Promise<GrowthTool | null> {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const { data } = await db().from("wa_growth_tools").select("*").eq("tenant_id", tenantId).eq("active", true).not("prefill", "is", null);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const tool = mapTool(r);
    if (tool.prefill && t.includes(tool.prefill.trim().toLowerCase())) return tool;
  }
  return null;
}

export async function recordGrowthConversion(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { data } = await db().from("wa_growth_tools").select("conversions").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  await db().from("wa_growth_tools").update({ conversions: ((data?.conversions as number) ?? 0) + 1 }).eq("tenant_id", tenantId).eq("id", id);
}
