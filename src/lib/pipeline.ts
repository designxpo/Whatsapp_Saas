// Sales pipeline — a lightweight, WhatsApp-native Kanban (multi-tenant). Each
// contact sits in at most one stage. Stages are configurable + ordered + tenant-
// scoped; moving a contact can fire automation (tag + sequence) and, when this
// tenant has LeadSquared connected, push the matching ProspectStage (hybrid).

import { DEFAULT_TENANT_ID } from "./tenant";
import { db } from "./supabase";
import { addContactTag } from "./store";
import { enroll } from "./sequences";
import { getLeadIdByPhone, updateLeadStage, lsqConfigured } from "./leadsquared";

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  color: string | null;
  lsqStage: string | null;
  onEnterTag: string | null;
  onEnterSequenceId: string | null;
  isWon: boolean;
  isLost: boolean;
}

function mapStage(r: Record<string, unknown>): PipelineStage {
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    position: (r.position as number) ?? 0,
    color: (r.color as string | null) ?? null,
    lsqStage: (r.lsq_stage as string | null) ?? null,
    onEnterTag: (r.on_enter_tag as string | null) ?? null,
    onEnterSequenceId: (r.on_enter_sequence_id as string | null) ?? null,
    isWon: (r.is_won as boolean) ?? false,
    isLost: (r.is_lost as boolean) ?? false,
  };
}

export async function listStages(tenantId = DEFAULT_TENANT_ID): Promise<PipelineStage[]> {
  const { data } = await db().from("wa_pipeline_stages").select("*").eq("tenant_id", tenantId).order("position", { ascending: true });
  return (data ?? []).map(r => mapStage(r as Record<string, unknown>));
}

const DEFAULT_STAGES: { name: string; color: string; isWon?: boolean; isLost?: boolean }[] = [
  { name: "New", color: "#64748b" },
  { name: "Contacted", color: "#0ea5e9" },
  { name: "Qualified", color: "#8b5cf6" },
  { name: "Proposal", color: "#f59e0b" },
  { name: "Won", color: "#10b981", isWon: true },
  { name: "Lost", color: "#ef4444", isLost: true },
];

export async function ensureSeeded(tenantId = DEFAULT_TENANT_ID): Promise<PipelineStage[]> {
  const existing = await listStages(tenantId);
  if (existing.length) return existing;
  const rows = DEFAULT_STAGES.map((d, i) => ({ tenant_id: tenantId, name: d.name, position: i, color: d.color, is_won: !!d.isWon, is_lost: !!d.isLost }));
  await db().from("wa_pipeline_stages").insert(rows).then(() => {}, () => {});
  return listStages(tenantId);
}

export interface StageInput {
  id?: string; name: string; color?: string | null; lsqStage?: string | null;
  onEnterTag?: string | null; onEnterSequenceId?: string | null; isWon?: boolean; isLost?: boolean;
}
export async function saveStage(input: StageInput, tenantId = DEFAULT_TENANT_ID): Promise<PipelineStage> {
  const row: Record<string, unknown> = {
    name: input.name.trim(),
    color: input.color?.trim() || null,
    lsq_stage: input.lsqStage?.trim() || null,
    on_enter_tag: input.onEnterTag?.trim() || null,
    on_enter_sequence_id: input.onEnterSequenceId || null,
    is_won: input.isWon ?? false,
    is_lost: input.isLost ?? false,
  };
  if (input.id) {
    const { data, error } = await db().from("wa_pipeline_stages").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single();
    if (error) throw error;
    return mapStage(data as Record<string, unknown>);
  }
  const stages = await listStages(tenantId);
  row.tenant_id = tenantId;
  row.position = stages.length;
  const { data, error } = await db().from("wa_pipeline_stages").insert(row).select().single();
  if (error) throw error;
  return mapStage(data as Record<string, unknown>);
}

export async function deleteStage(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_pipeline_stages").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

export async function reorderStages(orderedIds: string[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await Promise.all(orderedIds.map((id, i) =>
    db().from("wa_pipeline_stages").update({ position: i }).eq("id", id).eq("tenant_id", tenantId).then(() => {}, () => {}),
  ));
}

export interface BoardCard {
  contactId: string; name: string; phone: string; tags: string[];
  stageId: string; lastMessage: string | null; lastInboundAt: string | null;
}
export interface Board { stages: PipelineStage[]; cards: BoardCard[] }

export async function getBoard(tenantId = DEFAULT_TENANT_ID, max = 500): Promise<Board> {
  const stages = await ensureSeeded(tenantId);
  const { data } = await db().from("contacts")
    .select("id,phone,name,tags,pipeline_stage_id,pipeline_updated_at")
    .eq("tenant_id", tenantId)
    .not("pipeline_stage_id", "is", null)
    .order("pipeline_updated_at", { ascending: false, nullsFirst: false })
    .limit(max);
  const rows = (data ?? []) as Record<string, unknown>[];
  const phones = [...new Set(rows.map(r => r.phone as string))].filter(Boolean);
  const convMap = new Map<string, { lastMessage: string | null; lastInboundAt: string | null }>();
  if (phones.length) {
    const { data: cs } = await db().from("wa_conversations").select("phone,last_message,last_inbound_at").eq("tenant_id", tenantId).in("phone", phones);
    for (const c of (cs ?? []) as Record<string, unknown>[]) {
      convMap.set(c.phone as string, { lastMessage: (c.last_message as string | null) ?? null, lastInboundAt: (c.last_inbound_at as string | null) ?? null });
    }
  }
  const cards: BoardCard[] = rows.map(r => ({
    contactId: r.id as string,
    name: (r.name as string) || "",
    phone: r.phone as string,
    tags: (r.tags as string[]) ?? [],
    stageId: r.pipeline_stage_id as string,
    lastMessage: convMap.get(r.phone as string)?.lastMessage ?? null,
    lastInboundAt: convMap.get(r.phone as string)?.lastInboundAt ?? null,
  }));
  return { stages, cards };
}

// Fast path: set the contact's stage (tenant-scoped). Rejects a stage that isn't
// this tenant's so a crafted request can't move a card into another tenant.
export async function moveContact(contactId: string, stageId: string | null, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  if (stageId) {
    const ok = (await listStages(tenantId)).some(s => s.id === stageId);
    if (!ok) throw new Error("Stage not found");
  }
  const { error } = await db().from("contacts")
    .update({ pipeline_stage_id: stageId, pipeline_updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId);
  if (error) throw error;
}

// Side effects of landing in a stage (best-effort, run in after()): auto-tag,
// auto-enrol, and push the mapped LeadSquared ProspectStage for this tenant.
export async function applyStageEffects(contactId: string, stageId: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { data: c } = await db().from("contacts").select("phone").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  const phone = (c?.phone as string) || "";
  if (!phone) return;
  const stage = (await listStages(tenantId)).find(s => s.id === stageId);
  if (!stage) return;
  if (stage.onEnterTag) await addContactTag(phone, stage.onEnterTag, tenantId).catch(() => {});
  if (stage.onEnterSequenceId) await enroll(stage.onEnterSequenceId, { phone, platform: "whatsapp" }, tenantId).catch(() => {});
  if (stage.lsqStage && (await lsqConfigured(tenantId))) {
    const leadId = await getLeadIdByPhone(phone, tenantId).catch(() => null);
    if (leadId) await updateLeadStage(leadId, stage.lsqStage, tenantId).catch(() => {});
  }
}
