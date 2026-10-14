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

// ── Session-level refs (0118) ────────────────────────────────────────────────
//
// resolveRef answers "which campaign link was this?". These answer "which
// VISITOR, and where did they actually come from?" — which is the question a
// source code structurally cannot answer, because everyone who clicks the
// same link shares it.
//
// The code is short and the ROW carries the payload: the invisible encoder
// above carries base36 only and tops out at 16 characters, while a
// utm_campaign is arbitrary text of arbitrary length.

import { randomBytes } from "crypto";
import { hasAttribution, type UtmSet } from "./attribution";

// 12 chars: 36^12 is about 4.7e18, and — the load-bearing part — a source
// ref_code is always exactly 7 (genCode above), so a session code can never
// be mistaken for one. That is what makes resolving session-first SAFE rather
// than merely unlikely to collide.
const SESSION_CODE_LEN = 12;

// crypto, not Math.random. A collision here would attribute one visitor's
// click id to a different visitor — silently, and in the direction that
// corrupts ad bidding data rather than merely losing it. The unique index is
// the backstop; this is what stops it ever being reached.
function mintSessionCode(): string {
  let out = "";
  while (out.length < SESSION_CODE_LEN) {
    for (const b of randomBytes(SESSION_CODE_LEN)) {
      // 252 = 36*7: rejecting the top four values keeps every symbol equally
      // likely, where a bare modulo would bias the first four.
      if (b < 252) out += B36[b % 36];
      if (out.length >= SESSION_CODE_LEN) break;
    }
  }
  return out;
}

export interface SessionRef {
  refCode: string;
  tenantId: string;
  sclxId: string | null;
  sourceRefCode: string | null;
  utm: UtmSet;
}

/**
 * Called by /chat when a visitor arrives carrying attribution.
 *
 * Returns the code to embed in the invisible ref, or null on ANY failure —
 * the caller then falls back to the plain source ref, which is the behaviour
 * without this table at all. A visitor must never be held up, or lose their
 * way to WhatsApp, for the sake of a tracking row.
 *
 * The gate is "any signal", deliberately. Requiring a click id would mean
 * GOOGLE PAID ONLY: a visitor from a Facebook post, an organic search or a
 * newsletter carries UTM parameters and no click id, and they are precisely
 * the traffic "organic or paid, Google or Facebook?" is asking about.
 */
export async function createSessionRef(p: {
  tenantId: string;
  utm?: UtmSet;
  sclxId?: string | null;
  sourceRefCode?: string | null;
  pagePath?: string | null;
}): Promise<string | null> {
  const utm = p.utm ?? {};
  if (!p.sclxId && !hasAttribution(utm)) return null;
  try {
    const refCode = mintSessionCode();
    const { error } = await db().from("wa_session_refs").insert({
      tenant_id: p.tenantId,
      ref_code: refCode,
      gclid: utm.gclid || null,
      fbclid: utm.fbclid || null,
      sclx_id: p.sclxId || null,
      utm_source: utm.source || null,
      utm_medium: utm.medium || null,
      utm_campaign: utm.campaign || null,
      utm_term: utm.term || null,
      utm_content: utm.content || null,
      source_ref_code: p.sourceRefCode || null,
      page_path: p.pagePath || null,
    });
    if (error) {
      console.error(`[handlehub] createSessionRef (migration 0118 applied?): ${error.message}`);
      return null;
    }
    return refCode;
  } catch (err) {
    console.error("[handlehub] createSessionRef threw:", err);
    return null;
  }
}

/**
 * Resolve a parsed ref as a SESSION code. Returns null when it is a plain
 * source code, and the caller then uses resolveRef() exactly as before.
 *
 * Unscoped by construction, and the row's tenant_id is the answer rather than
 * the question: the inbound webhook knows its tenant from the channel, but
 * /chat minted this before any tenant context existed. The length guard is
 * not an optimisation for its own sake — every organic tracked-link inbound
 * would otherwise pay for a miss on this table.
 */
export async function resolveSessionRef(code: string): Promise<SessionRef | null> {
  const c = (code || "").toLowerCase().trim();
  if (c.length !== SESSION_CODE_LEN) return null;
  try {
    const { data } = await db().from("wa_session_refs")
      .select("ref_code, tenant_id, sclx_id, source_ref_code, gclid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content")
      .eq("ref_code", c).maybeSingle();
    if (!data) return null;
    const r = data as Record<string, string | null>;
    return {
      refCode: r.ref_code as string,
      tenantId: r.tenant_id as string,
      sclxId: r.sclx_id,
      sourceRefCode: r.source_ref_code,
      utm: {
        source: r.utm_source, medium: r.utm_medium, campaign: r.utm_campaign,
        term: r.utm_term, content: r.utm_content,
        gclid: r.gclid, fbclid: r.fbclid,
      },
    };
  } catch (err) {
    console.error("[handlehub] resolveSessionRef threw:", err);
    return null;
  }
}

/** Soft metric — how many minted sessions actually produced a message. */
export async function markSessionRefMatched(refCode: string, waId: string): Promise<void> {
  try {
    await db().from("wa_session_refs")
      .update({ matched_at: new Date().toISOString(), matched_wa_id: waId })
      .eq("ref_code", refCode);
  } catch { /* soft — never break the inbound path */ }
}

export interface BridgeTarget {
  tenantId: string;
  entryPoint: HandleEntryPoint;
  source: HandleSource | null;
  link: string;
  sessionRefCode: string | null;
}

/**
 * What /chat should send this visitor to.
 *
 * Unscoped on purpose: a public visitor carries no session, so the ref code
 * IS the thing that says which business this belongs to. The same shape
 * registerClick already uses for tracked short links.
 */
export async function resolveBridgeTarget(
  src: string,
  attribution?: { utm?: UtmSet; sclxId?: string | null; pagePath?: string | null },
): Promise<BridgeTarget | null> {
  const key = (src || "").trim().toLowerCase();
  if (!key) return null;

  const { data } = await db().from("wa_handle_sources").select("*").eq("ref_code", key).maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const tenantId = row.tenant_id as string;
  const source = mapSource(row);

  const eps = await listEntryPoints(tenantId);
  const entryPoint = eps.find(e => e.id === source.entryPointId && e.number);
  // A source whose entry point has lost its number cannot produce a link, and
  // falling back to another number would book the conversation under a line
  // the visitor never used.
  if (!entryPoint) return null;

  const utm: UtmSet = attribution?.utm ?? {};
  let sessionRefCode: string | null = null;
  if (attribution && (attribution.sclxId || hasAttribution(utm))) {
    sessionRefCode = await createSessionRef({
      tenantId, utm, sclxId: attribution.sclxId,
      sourceRefCode: source.refCode, pagePath: attribution.pagePath ?? null,
    });
  }

  const link = trackedLink(entryPoint, { refCode: sessionRefCode ?? source.refCode });
  return link ? { tenantId, entryPoint, source, link, sessionRefCode } : null;
}

/** The public URL to hand an ad platform for a given source. */
export function bridgeUrl(origin: string, source: Pick<HandleSource, "refCode">): string {
  return `${origin.replace(/\/$/, "")}/chat?src=${encodeURIComponent(source.refCode)}`;
}
