// Handle Hub — branded WhatsApp entry points surfaced everywhere as per-source
// TRACKED links + QR codes, so every conversation's origin (which QR / ad / post)
// is captured. A tenant can run multiple entry points (numbers) — e.g. a PPC
// number and an organic number can each have their own set of tracked sources.
// The @handle becomes the prettier front once Meta's Cloud API exposes
// username click-to-chat (WHATSAPP-USERNAME-PLAN.md).
//
// Attribution mechanism: each source embeds a short "[ref:CODE]" token in the
// click-to-chat prefilled text. On the first inbound the webhook reads the code,
// records the touch, tags the contact's source, and strips the token from the
// stored message. Best-effort — if the user edits the prefilled text away, the
// chat still works, it's just unattributed (the same limit every such tool has).

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";
import QRCode from "qrcode";

export interface HandleEntryPoint {
  id: string; label: string; number: string; handle: string; greeting: string; createdAt: string;
}
export interface HandleSource {
  id: string; entryPointId: string; label: string; refCode: string; kind: string;
  touches: number; lastTouchAt: string | null; createdAt: string;
}
const DEFAULT_GREETING = "Hi! I'd like to know more.";

// ── Entry points (CRUD) — one per WhatsApp number, per tenant ─────────────────
function mapEntryPoint(r: Record<string, unknown>): HandleEntryPoint {
  return {
    id: r.id as string, label: (r.label as string) ?? "", number: (r.number as string) ?? "",
    handle: (r.handle as string) ?? "", greeting: (r.greeting as string) || DEFAULT_GREETING,
    createdAt: r.created_at as string,
  };
}

export async function listEntryPoints(tenantId = DEFAULT_TENANT_ID): Promise<HandleEntryPoint[]> {
  const { data } = await db().from("wa_handle_entry_points").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: true });
  return (data ?? []).map(r => mapEntryPoint(r as Record<string, unknown>));
}

export async function createEntryPoint(tenantId: string, p: { label?: string; number: string; handle?: string; greeting?: string }): Promise<HandleEntryPoint> {
  const number = (p.number || "").replace(/\D/g, "");
  if (!number) throw new Error("A WhatsApp number is required");
  const ins = await db().from("wa_handle_entry_points").insert({
    tenant_id: tenantId,
    label: (p.label || "").trim().slice(0, 80) || `WhatsApp ${number.slice(-4)}`,
    number,
    handle: (p.handle || "").replace(/^@+/, "").trim().slice(0, 60),
    greeting: (p.greeting || "").trim().slice(0, 300) || DEFAULT_GREETING,
  }).select().single();
  if (ins.error || !ins.data) throw new Error(ins.error?.message || "Could not create entry point");
  return mapEntryPoint(ins.data as Record<string, unknown>);
}

export async function updateEntryPoint(id: string, tenantId: string, p: { label?: string; number?: string; handle?: string; greeting?: string }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (p.label !== undefined) patch.label = p.label.trim().slice(0, 80);
  if (p.number !== undefined) patch.number = p.number.replace(/\D/g, "");
  if (p.handle !== undefined) patch.handle = p.handle.replace(/^@+/, "").trim().slice(0, 60);
  if (p.greeting !== undefined) patch.greeting = (p.greeting || "").trim().slice(0, 300) || DEFAULT_GREETING;
  if (Object.keys(patch).length) await db().from("wa_handle_entry_points").update(patch).eq("id", id).eq("tenant_id", tenantId);
}

// Cascades — deleting an entry point deletes its sources too (FK on delete cascade).
export async function deleteEntryPoint(id: string, tenantId: string): Promise<void> {
  await db().from("wa_handle_entry_points").delete().eq("id", id).eq("tenant_id", tenantId);
}

// ── Sources (CRUD) — each belongs to exactly one entry point ─────────────────
function mapSource(r: Record<string, unknown>): HandleSource {
  return {
    id: r.id as string, entryPointId: (r.entry_point_id as string) ?? "", label: (r.label as string) ?? "",
    refCode: (r.ref_code as string) ?? "", kind: (r.kind as string) ?? "link", touches: (r.touches as number) ?? 0,
    lastTouchAt: (r.last_touch_at as string | null) ?? null, createdAt: r.created_at as string,
  };
}

export async function listSources(tenantId = DEFAULT_TENANT_ID): Promise<HandleSource[]> {
  const { data } = await db().from("wa_handle_sources").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapSource(r as Record<string, unknown>));
}

const genCode = () => Math.random().toString(36).slice(2, 9);   // 7-char base36

export async function createSource(tenantId: string, p: { entryPointId: string; label: string; kind?: string }): Promise<HandleSource> {
  if (!p.entryPointId) throw new Error("Pick which WhatsApp number this tracked link should use");
  const label = (p.label || "").trim().slice(0, 80) || "Untitled source";
  const kind = (p.kind || "link").trim().slice(0, 20);
  // Retry on the (rare) ref-code collision — the unique index is the source of truth.
  for (let i = 0; i < 6; i++) {
    const ins = await db().from("wa_handle_sources").insert({ tenant_id: tenantId, entry_point_id: p.entryPointId, label, ref_code: genCode(), kind }).select().single();
    if (!ins.error && ins.data) return mapSource(ins.data as Record<string, unknown>);
  }
  throw new Error("Could not allocate a unique ref code");
}

export async function deleteSource(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_handle_sources").delete().eq("tenant_id", tenantId).eq("id", id);
}

// ── Tracked link + QR ────────────────────────────────────────────────────────
// wa.me click-to-chat with the ref token appended to the prefilled greeting.
// Returns null when no number is configured yet (nothing to point the link at).
export function trackedLink(entryPoint: Pick<HandleEntryPoint, "number" | "handle" | "greeting">, source: Pick<HandleSource, "refCode">): string | null {
  if (!entryPoint.number) return null;
  const text = `${entryPoint.greeting} [ref:${source.refCode}]`;
  return `https://wa.me/${entryPoint.number}?text=${encodeURIComponent(text)}`;
}

export async function qrDataUrl(link: string): Promise<string> {
  return QRCode.toDataURL(link, { width: 320, margin: 1 });
}

// ── Attribution (inbound) ─────────────────────────────────────────────────────
// Matches "[ref:CODE]" or "(ref:CODE)" (case-insensitive) in a prefilled message.
export const REF_RE = /[[(]\s*ref\s*:\s*([a-z0-9]{4,16})\s*[\])]/i;

export function parseRef(text: string): string | null {
  const m = (text || "").match(REF_RE);
  return m ? m[1].toLowerCase() : null;
}

// Remove the token so the stored/answered message is the customer's real text.
export function stripRef(text: string): string {
  return (text || "").replace(REF_RE, "").replace(/\s{2,}/g, " ").trim();
}

export async function resolveRef(tenantId: string, code: string): Promise<HandleSource | null> {
  const c = (code || "").toLowerCase().trim();
  if (!c) return null;
  const { data } = await db().from("wa_handle_sources").select("*").eq("tenant_id", tenantId).eq("ref_code", c).maybeSingle();
  return data ? mapSource(data as Record<string, unknown>) : null;
}

// Increment the touch counter (soft metric; read-modify-write is fine — a lost
// concurrent increment on a marketing counter is acceptable). Never throws.
export async function recordTouch(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    const { data } = await db().from("wa_handle_sources").select("touches").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    const touches = ((data as { touches?: number } | null)?.touches ?? 0) + 1;
    await db().from("wa_handle_sources").update({ touches, last_touch_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id);
  } catch { /* soft metric — never break the inbound path */ }
}
