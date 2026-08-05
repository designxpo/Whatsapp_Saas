// Handle Hub — branded WhatsApp entry points surfaced everywhere as per-source
// TRACKED links + QR codes, so every conversation's origin (which QR / ad / post)
// is captured. A tenant can run multiple entry points (numbers) — e.g. a PPC
// number and an organic number can each have their own set of tracked sources.
// The @handle becomes the prettier front once Meta's Cloud API exposes
// username click-to-chat (WHATSAPP-USERNAME-PLAN.md).
//
// Attribution mechanism: each source embeds its ref code as INVISIBLE
// zero-width characters appended after the greeting — the customer's
// prefilled (and sent) message reads clean, with nothing bracketed or
// odd-looking, in their own WhatsApp thread. On the first inbound the webhook
// decodes it, records the touch, tags the contact's source, and strips it
// before anything downstream (chatbot, Live Chat, LeadSquared) ever sees it.
// Best-effort — if the customer deletes the prefilled text, the chat still
// works, it's just unattributed (the same limit every such tool has). Old
// links already handed out used a visible "[ref:CODE]" bracket —
// parseRef/stripRef still recognize that format too.

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

// ── Invisible ref encoding — zero-width characters, nothing visible ──────────
// U+200B/U+200C encode bits 0/1; U+200D×3 marks where the payload starts. A
// 4-bit length prefix (code length − 1, so 1–16 chars fit) precedes the 6-bit
// chunks (2^6=64 ≥ 36 base36 symbols) — codes aren't always exactly 7 chars
// (Math.random().toString(36) can occasionally yield fewer), so the length is
// encoded rather than assumed.
const ZW0 = "\u200B", ZW1 = "\u200C", ZW_MARK = "\u200D\u200D\u200D";
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function encodeInvisibleRef(code: string): string {
  const c = code.toLowerCase();
  if (!c.length || c.length > 16) return "";
  let bits = (c.length - 1).toString(2).padStart(4, "0");
  for (const ch of c) {
    const v = B36.indexOf(ch);
    if (v < 0) return "";
    bits += v.toString(2).padStart(6, "0");
  }
  return ZW_MARK + [...bits].map(b => (b === "1" ? ZW1 : ZW0)).join("");
}

function decodeInvisibleRef(text: string): string | null {
  const idx = (text || "").indexOf(ZW_MARK);
  if (idx < 0) return null;
  let bits = "";
  for (let i = idx + ZW_MARK.length; i < text.length; i++) {
    const ch = text[i];
    if (ch === ZW0) bits += "0";
    else if (ch === ZW1) bits += "1";
    else break;
  }
  if (bits.length < 4) return null;
  const len = parseInt(bits.slice(0, 4), 2) + 1;
  const need = 4 + len * 6;
  if (bits.length < need) return null;
  const chars: string[] = [];
  for (let i = 4; i < need; i += 6) {
    const v = parseInt(bits.slice(i, i + 6), 2);
    if (v >= B36.length) return null;   // corrupted/edited payload
    chars.push(B36[v]);
  }
  return chars.join("");
}

function stripInvisibleRef(text: string): string {
  const idx = (text || "").indexOf(ZW_MARK);
  if (idx < 0) return text || "";
  let end = idx + ZW_MARK.length;
  while (end < text.length && (text[end] === ZW0 || text[end] === ZW1)) end++;
  return text.slice(0, idx) + text.slice(end);
}

// ── Tracked link + QR ────────────────────────────────────────────────────────
// wa.me click-to-chat with the ref token appended (invisibly) to the prefilled
// greeting. Returns null when no number is configured yet.
export function trackedLink(entryPoint: Pick<HandleEntryPoint, "number" | "handle" | "greeting">, source: Pick<HandleSource, "refCode">): string | null {
  if (!entryPoint.number) return null;
  const text = `${entryPoint.greeting}${encodeInvisibleRef(source.refCode)}`;
  return `https://wa.me/${entryPoint.number}?text=${encodeURIComponent(text)}`;
}

export async function qrDataUrl(link: string): Promise<string> {
  return QRCode.toDataURL(link, { width: 320, margin: 1 });
}

// ── Attribution (inbound) ─────────────────────────────────────────────────────
// Legacy visible format, still recognized for any link already handed out
// before the invisible encoding shipped. Matches "[ref:CODE]" or "(ref:CODE)"
// (case-insensitive).
export const REF_RE = /[[(]\s*ref\s*:\s*([a-z0-9]{4,16})\s*[\])]/i;

export function parseRef(text: string): string | null {
  const inv = decodeInvisibleRef(text || "");
  if (inv) return inv;
  const m = (text || "").match(REF_RE);
  return m ? m[1].toLowerCase() : null;
}

// Remove the token so the stored/answered message is the customer's real text.
export function stripRef(text: string): string {
  return stripInvisibleRef(text || "").replace(REF_RE, "").replace(/\s{2,}/g, " ").trim();
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
