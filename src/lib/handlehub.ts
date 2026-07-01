// Handle Hub — one branded WhatsApp entry point surfaced everywhere as per-source
// TRACKED links + QR codes, so every conversation's origin (which QR / ad / post)
// is captured. Works today on the tenant's number; the @handle becomes the prettier
// front once Meta's Cloud API exposes username click-to-chat (WHATSAPP-USERNAME-PLAN.md).
//
// Attribution mechanism: each source embeds a short "[ref:CODE]" token in the
// click-to-chat prefilled text. On the first inbound the webhook reads the code,
// records the touch, tags the contact's source, and strips the token from the
// stored message. Best-effort — if the user edits the prefilled text away, the
// chat still works, it's just unattributed (the same limit every such tool has).

import { db } from "./supabase";
import { getTenantSetting, setTenantSetting } from "./store";
import { DEFAULT_TENANT_ID } from "./tenant";
import QRCode from "qrcode";

export interface HandleSource {
  id: string; label: string; refCode: string; kind: string;
  touches: number; lastTouchAt: string | null; createdAt: string;
}
export interface HandleHubConfig { number: string; handle: string; greeting: string }

const CFG = { number: "handle_hub_number", handle: "handle_hub_handle", greeting: "handle_hub_greeting" } as const;
const DEFAULT_GREETING = "Hi! I'd like to know more.";

// ── Config (per tenant, in wa_settings) ──────────────────────────────────────
export async function getHandleHubConfig(tenantId = DEFAULT_TENANT_ID): Promise<HandleHubConfig> {
  const [number, handle, greeting] = await Promise.all([
    getTenantSetting<string>(tenantId, CFG.number, ""),
    getTenantSetting<string>(tenantId, CFG.handle, ""),
    getTenantSetting<string>(tenantId, CFG.greeting, DEFAULT_GREETING),
  ]);
  return {
    number: (number || "").replace(/\D/g, ""),
    handle: (handle || "").replace(/^@+/, "").trim(),
    greeting: (greeting || DEFAULT_GREETING).trim() || DEFAULT_GREETING,
  };
}
export async function setHandleHubConfig(tenantId: string, p: Partial<HandleHubConfig>): Promise<void> {
  if (p.number !== undefined) await setTenantSetting(tenantId, CFG.number, p.number.replace(/\D/g, ""));
  if (p.handle !== undefined) await setTenantSetting(tenantId, CFG.handle, p.handle.replace(/^@+/, "").trim());
  if (p.greeting !== undefined) await setTenantSetting(tenantId, CFG.greeting, (p.greeting || "").slice(0, 300));
}

// ── Sources (CRUD) ───────────────────────────────────────────────────────────
function mapSource(r: Record<string, unknown>): HandleSource {
  return {
    id: r.id as string, label: (r.label as string) ?? "", refCode: (r.ref_code as string) ?? "",
    kind: (r.kind as string) ?? "link", touches: (r.touches as number) ?? 0,
    lastTouchAt: (r.last_touch_at as string | null) ?? null, createdAt: r.created_at as string,
  };
}

export async function listSources(tenantId = DEFAULT_TENANT_ID): Promise<HandleSource[]> {
  const { data } = await db().from("wa_handle_sources").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapSource(r as Record<string, unknown>));
}

const genCode = () => Math.random().toString(36).slice(2, 9);   // 7-char base36

export async function createSource(tenantId: string, p: { label: string; kind?: string }): Promise<HandleSource> {
  const label = (p.label || "").trim().slice(0, 80) || "Untitled source";
  const kind = (p.kind || "link").trim().slice(0, 20);
  // Retry on the (rare) ref-code collision — the unique index is the source of truth.
  for (let i = 0; i < 6; i++) {
    const ins = await db().from("wa_handle_sources").insert({ tenant_id: tenantId, label, ref_code: genCode(), kind }).select().single();
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
export function trackedLink(cfg: HandleHubConfig, source: Pick<HandleSource, "refCode">): string | null {
  if (!cfg.number) return null;
  const text = `${cfg.greeting} [ref:${source.refCode}]`;
  return `https://wa.me/${cfg.number}?text=${encodeURIComponent(text)}`;
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
