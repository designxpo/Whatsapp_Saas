import { DEFAULT_TENANT_ID } from "./tenant";
// LeadSquared CRM sync — PER TENANT. Each tenant configures their OWN LeadSquared
// credentials in Settings (keys stored encrypted via tenant secrets); the
// platform LSQ_* env vars are a fallback ONLY for the default tenant (the
// single-tenant / internal deploy). So one tenant's CRM is never reachable by
// another, and a tenant with no CRM configured simply skips sync.
//
//   Access Key / Secret Key — LeadSquared API creds (My Profile → Settings → API & Webhooks)
//   API host                — region host, e.g. https://api-in21.leadsquared.com
//   Activity code           — event code of a Custom Activity (e.g. "WhatsApp Message")

import { errorMessage } from "./errors";
import { db } from "./supabase";
import { getTenantSetting, getTenantSecret } from "./store";
import { listIntegrations, getIntegrationSecret, setIntegrationError, type Integration } from "./integrations";


export interface LsqCreds {
  accessKey: string; secretKey: string; host: string; activityCode: number;
  taskCategory: string; igHandleField: string; waHandleField: string; autoCreate: boolean;
}

// Per-tenant setting keys (wa_settings). Access/secret keys live in tenant
// SECRETS (encrypted); the rest are plain settings.
export const LSQ_KEYS = {
  accessKey: "lsq_access_key", secretKey: "lsq_secret_key", host: "lsq_api_host",
  activityCode: "lsq_activity_code", taskCategory: "lsq_task_category",
  igHandleField: "lsq_ig_handle_field", waHandleField: "lsq_wa_handle_field", autoCreate: "lsq_autocreate",
} as const;

const boolish = (v: string | null | undefined) => /^(1|true|yes|on)$/i.test(v ?? "");

// LeadSquared's Phone/Mobile fields are India-default: LSQ prepends the account
// country code (+91) to whatever we send, WITHOUT noticing a 91 already present —
// so sending "+919999730196" was stored as "+91-919999730196" (duplicate 91, so
// counselors had to hand-edit the number before dialling). Send the 10-digit
// NATIONAL number for Indian numbers so LSQ's own prefix yields "+91-9999730196".
// Foreign numbers keep E.164 (best effort; the account is India-centric).
function lsqPhone(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  if (d.length === 10) return d;
  return d ? `+${d}` : "";
}

// Scrub a lead Source before it reaches LSQ. Zero-width characters (U+200B–200D,
// word-joiner U+2060, BOM) sneak in when a value is pasted from a doc/sheet — a
// channel source arrived as "⁠PPC-Whatsapp", which no dashboard filter for
// "ppc-whatsapp" would ever match. Strip them (and trim) at the write point.
function cleanSource(s: string | undefined): string {
  return (s ?? "").replace(/[​-‍⁠﻿]/g, "").trim();
}

// A phone we should never try to create a CRM lead for. Web-chat/IG visitors
// type junk ("0000000000", a 5-digit test), LeadSquared rejects it as an invalid
// number, and the push then RETRIES TO DEAD and reddens the health card forever.
// Treat an implausible number as "no real lead" (a clean no-op), not a retriable
// failure. Deliberately lenient — only blocks the obviously bogus.
export function plausiblePhone(phone: string | null | undefined): boolean {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 15) return false;
  const nat = d.length > 10 ? d.slice(-10) : d;
  if (/^(\d)\1{9}$/.test(nat)) return false;   // all one digit — 0000000000, 1111111111…
  if (nat.startsWith("0")) return false;        // a real national mobile never leads with 0
  return true;
}

// LeadSquared is a connection in the Integrations hub — find this tenant's active
// one (its creds + visible status live on it).
async function findLsqIntegration(tenantId: string): Promise<Integration | null> {
  try { return (await listIntegrations(tenantId)).find(i => i.kind === "leadsquared" && i.active) ?? null; }
  catch { return null; }
}

// Surface a sync failure on the LeadSquared connection's hub card (same visible
// status the other connectors get). A successful "Test" flips it back to connected.
async function noteLsqFailure(tenantId: string, detail: string): Promise<void> {
  try { const integ = await findLsqIntegration(tenantId); if (integ) await setIntegrationError(integ.id, tenantId, detail); }
  catch { /* best-effort — never break the message path */ }
}

// Platform env creds — fallback for the default tenant only.
function envCfg(): LsqCreds | null {
  const accessKey = process.env.LSQ_ACCESS_KEY ?? "";
  const secretKey = process.env.LSQ_SECRET_KEY ?? "";
  const host = (process.env.LSQ_API_HOST ?? "").replace(/\/+$/, "");
  const activityCode = parseInt(process.env.LSQ_ACTIVITY_CODE ?? "", 10);
  if (!(accessKey && secretKey && host && Number.isFinite(activityCode))) return null;
  return {
    accessKey, secretKey, host, activityCode,
    taskCategory: process.env.LSQ_TASK_CATEGORY || "2",
    igHandleField: (process.env.LSQ_IG_HANDLE_FIELD ?? "").trim(),
    waHandleField: (process.env.LSQ_WA_HANDLE_FIELD ?? "").trim(),
    autoCreate: boolish(process.env.LSQ_AUTOCREATE_LEADS),
  };
}

// Resolve a tenant's LeadSquared credentials. Source order:
//   1) their LeadSquared connection in the Integrations hub (how it's set up now)
//   2) legacy per-tenant settings (configured before LSQ moved into the hub)
//   3) platform env — default tenant only
// Returns null when this tenant has no CRM configured.
export async function resolveLsq(tenantId: string = DEFAULT_TENANT_ID): Promise<LsqCreds | null> {
  // 1) Integrations hub connection — both keys live in its encrypted secret as
  //    JSON {accessKey, secretKey}; host/activityCode/etc. live in its config.
  try {
    const integ = await findLsqIntegration(tenantId);
    if (integ) {
      let accessKey = "", secretKey = "";
      try { const k = JSON.parse((await getIntegrationSecret(integ.id, tenantId)) ?? "") as { accessKey?: string; secretKey?: string }; accessKey = k.accessKey ?? ""; secretKey = k.secretKey ?? ""; } catch { /* malformed secret */ }
      const cfg = integ.config as Record<string, unknown>;
      const host = String(cfg.host ?? "").replace(/\/+$/, "");
      const activityCode = parseInt(String(cfg.activityCode ?? ""), 10);
      if (accessKey && secretKey && host && Number.isFinite(activityCode)) {
        return {
          accessKey, secretKey, host, activityCode,
          taskCategory: String(cfg.taskCategory ?? "") || "2",
          igHandleField: String(cfg.igHandleField ?? "").trim(),
          waHandleField: String(cfg.waHandleField ?? "").trim(),
          autoCreate: !!cfg.autoCreate,
        };
      }
    }
  } catch (err) {
    console.error("[leadsquared] hub cred resolve failed:", errorMessage(err));
  }

  // 2) Legacy per-tenant settings — kept so setups made before the hub keep syncing.
  try {
    const accessKey = (await getTenantSecret(tenantId, LSQ_KEYS.accessKey)) ?? "";
    const secretKey = (await getTenantSecret(tenantId, LSQ_KEYS.secretKey)) ?? "";
    const host = ((await getTenantSetting<string | null>(tenantId, LSQ_KEYS.host, null)) ?? "").replace(/\/+$/, "");
    const activityCode = parseInt((await getTenantSetting<string | null>(tenantId, LSQ_KEYS.activityCode, null)) ?? "", 10);
    if (accessKey && secretKey && host && Number.isFinite(activityCode)) {
      return {
        accessKey, secretKey, host, activityCode,
        taskCategory: (await getTenantSetting<string | null>(tenantId, LSQ_KEYS.taskCategory, null)) || "2",
        igHandleField: ((await getTenantSetting<string | null>(tenantId, LSQ_KEYS.igHandleField, null)) ?? "").trim(),
        waHandleField: ((await getTenantSetting<string | null>(tenantId, LSQ_KEYS.waHandleField, null)) ?? "").trim(),
        autoCreate: boolish(await getTenantSetting<string | null>(tenantId, LSQ_KEYS.autoCreate, null)),
      };
    }
  } catch (err) {
    console.error("[leadsquared] legacy cred resolve failed:", errorMessage(err));
  }

  // 3) Platform env — default tenant only.
  if (tenantId === DEFAULT_TENANT_ID) return envCfg();
  return null;
}

export async function lsqConfigured(tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  return (await resolveLsq(tenantId)) !== null;
}

// Read-only connectivity check for the Setup wizard. RetrieveLeadByPhoneNumber
// with a dummy number NEVER creates data — a 200 (even empty) means the keys +
// host are valid; 401/403 means bad keys. Honours "do not create test leads".
export async function verifyLsq(tenantId: string = DEFAULT_TENANT_ID): Promise<{ ok: boolean; detail: string }> {
  const c = await resolveLsq(tenantId);
  if (!c) return { ok: false, detail: "LeadSquared isn't set up for this workspace yet — add your keys in Settings." };
  try {
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&phone=${encodeURIComponent("+10000000000")}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, detail: "Connected — your LeadSquared keys work." };
    if (res.status === 401 || res.status === 403) return { ok: false, detail: "LeadSquared rejected the keys — double-check your Access Key and Secret Key." };
    return { ok: false, detail: `LeadSquared returned HTTP ${res.status} — check the API host region (e.g. https://api-in21.leadsquared.com).` };
  } catch {
    return { ok: false, detail: "Couldn't reach LeadSquared — check the API host URL is correct, then try again." };
  }
}

// LSQ was minting DUPLICATE leads for one number: concurrent inbound events
// (the activity mirror + a form completion both fire via after()) each missed
// the lookup and each called Lead.Capture — and Capture's own dedup follows
// the org's rules (often email-only), so same-phone twins were born. Fixed at
// this single choke point: one in-flight upsert per tenant+number (serialized),
// find-FIRST-then-update-by-id, plus a short memory of freshly created ids
// because LSQ's phone search indexes a new lead with a small lag.
const leadUpsertQueue = new Map<string, Promise<string | null>>();
const recentLeadIds = new Map<string, { id: string; at: number }>();
const RECENT_LEAD_TTL = 10 * 60_000;

// Creates the lead if the phone is genuinely new, otherwise updates the
// EXISTING lead by id (extra fields only — Source/Owner/names a salesperson
// curated are never overwritten). Returns the ProspectID, or null on failure /
// when the tenant has no CRM.
export async function createOrUpdateLead(p: { phone: string; name?: string; source?: string; fields?: { Attribute: string; Value: string }[] }, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  if (!c) return null;
  const digits = (p.phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const key = `${tenantId}:${digits.slice(-10)}`;
  const prev = leadUpsertQueue.get(key) ?? Promise.resolve(null);
  const run = prev.then(() => upsertLead(p, digits, key, c), () => upsertLead(p, digits, key, c));
  leadUpsertQueue.set(key, run);
  try { return await run; }
  finally { if (leadUpsertQueue.get(key) === run) leadUpsertQueue.delete(key); }
}

async function upsertLead(p: { phone: string; name?: string; source?: string; fields?: { Attribute: string; Value: string }[] }, digits: string, key: string, c: LsqCreds): Promise<string | null> {
  try {
    const recent = recentLeadIds.get(key);
    const existing = (recent && Date.now() - recent.at < RECENT_LEAD_TTL ? recent.id : null)
      ?? await findLeadId(digits, c).catch(() => null);
    if (existing) {
      recentLeadIds.set(key, { id: existing, at: Date.now() });
      const fields = p.fields ?? [];
      if (fields.length) {
        const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Update?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&leadId=${encodeURIComponent(existing)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
        });
        if (!res.ok) console.error(`[leadsquared] lead field update HTTP ${res.status} (lead ${existing}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
      }
      return existing;
    }
    const parts = (p.name || "").trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "", last = parts.slice(1).join(" ");
    const local = lsqPhone(digits);
    const attrs = [
      { Attribute: "Phone", Value: local },
      { Attribute: "Mobile", Value: local },
      ...(first ? [{ Attribute: "FirstName", Value: first }] : []),
      ...(last ? [{ Attribute: "LastName", Value: last }] : []),
      { Attribute: "Source", Value: cleanSource(p.source) || "WhatsApp" },
      ...(p.fields ?? []),
    ];
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Capture?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attrs),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { Status?: string; Message?: { Id?: string } } | null;
    const id = data?.Message?.Id ?? null;
    if (id) recentLeadIds.set(key, { id, at: Date.now() });
    return id;
  } catch (err) {
    console.error("[leadsquared] lead create failed:", errorMessage(err));
    return null;
  }
}

// Push a lead's flow/AI-CAPTURED profile fields (email, city) onto the matching
// LSQ lead — the missing half of the sync: we created leads from phone only and
// posted activity notes, but never wrote the email the qualification flow
// collected, so leads landed with a blank Email. Updates the EXISTING lead BY ID
// via Lead.Update, so the Source / Owner / ProspectStage are preserved (never
// overwritten with "WhatsApp"). Creates a lead only when none exists and the
// tenant's auto-create is on. Fire-and-forget; never throws.
export async function syncLeadProfile(p: { phone?: string | null; phoneAlt?: string | null; handle?: string | null; email?: string | null; city?: string | null; name?: string | null }, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  const c = await resolveLsq(tenantId);
  if (!c) return;
  try {
    const email = (p.email || "").trim();
    const city = (p.city || "").trim();
    const name = (p.name || "").trim();
    const phone = (p.phone || "").trim();
    const handle = (p.handle || "").replace(/^@+/, "").trim();
    const fields: { Attribute: string; Value: string }[] = [];
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.push({ Attribute: "EmailAddress", Value: email });
    if (city) fields.push({ Attribute: "mx_City", Value: city });
    // An ALTERNATE number the lead shared in chat lands in the standard Phone
    // field — Mobile stays their WhatsApp number (the identity/dedup key).
    // National form (see lsqPhone) so LSQ's +91 prefix doesn't duplicate.
    const alt = (p.phoneAlt || "").replace(/\D/g, "");
    if (alt.length >= 10 && alt.length <= 15) fields.push({ Attribute: "Phone", Value: lsqPhone(alt) });
    // Persist the WhatsApp @handle onto the lead so future handle-only inbound
    // (hidden number) still resolves to this lead — the CRM dedupes by handle.
    if (handle && c.waHandleField) fields.push({ Attribute: c.waHandleField, Value: handle });
    if (!fields.length && !name) return;   // nothing CRM-relevant to write (no fields, no name to backfill)

    // Resolve by phone first (full record — we need the current name); fall back
    // to the @handle when the number is unknown.
    const lead = phone ? await retrieveLead(phone, c) : null;
    let leadId = (lead?.ProspectID as string | undefined) ?? null;
    if (!leadId && handle && c.waHandleField) leadId = await findLeadIdByHandle(handle, c, c.waHandleField);
    // BACKFILL the name onto an existing lead ONLY when it has none yet — a
    // flow/profile-captured name used to be dropped here, leaving the CRM
    // showing "No Name". Never overwrite a name PPC/a salesperson curated.
    if (name && lead) {
      const named = String(lead.FirstName ?? "").trim() || String(lead.LastName ?? "").trim();
      if (!named) {
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts[0]) fields.push({ Attribute: "FirstName", Value: parts[0] });
        if (parts.length > 1) fields.push({ Attribute: "LastName", Value: parts.slice(1).join(" ") });
      }
    }
    if (leadId) {
      if (!fields.length) return;   // lead already complete — nothing to write
      const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Update?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&leadId=${encodeURIComponent(leadId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
      });
      if (!res.ok) console.error(`[leadsquared] profile update HTTP ${res.status} (lead ${leadId}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
    } else if (c.autoCreate && phone) {
      await createOrUpdateLead({ phone, name: name || undefined, source: "WhatsApp", fields }, tenantId);
    }
  } catch (err) {
    console.error("[leadsquared] profile sync failed:", errorMessage(err));
  }
}

// Returns the lead's ProspectID by phone, creating it only if auto-create is on.
export async function ensureLead(phone: string, name?: string, source?: string, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  if (!c) return null;
  // Null-safe: a failed lookup (findLeadId now throws on total rejection) reads
  // as "not found" for panel actions.
  const existing = await findLeadId(phone, c).catch(() => null);
  if (existing) return existing;
  return createOrUpdateLead({ phone, name, source }, tenantId);
}

// Public phone→ProspectID lookup (for panel actions that must NOT create).
export async function getLeadIdByPhone(phone: string, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  return c ? findLeadId(phone, c).catch(() => null) : null;
}

// Moves a lead to a new ProspectStage. Returns true on success.
export async function updateLeadStage(leadId: string, stage: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  const c = await resolveLsq(tenantId);
  if (!c || !leadId || !stage) return false;
  try {
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Update?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&leadId=${encodeURIComponent(leadId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ Attribute: "ProspectStage", Value: stage }]),
    });
    return res.ok;
  } catch (err) {
    console.error("[leadsquared] stage update failed:", errorMessage(err));
    return false;
  }
}

// Creates a follow-up task on a lead, due tomorrow by default. Returns true on success.
export async function createLeadTask(leadId: string, p: { name: string; notes?: string; dueDate?: string }, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  const c = await resolveLsq(tenantId);
  if (!c || !leadId || !p.name?.trim()) return false;
  try {
    const due = p.dueDate || new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const res = await fetch(`${c.host}/v2/Task.svc/Create?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Task: { Category: c.taskCategory, Name: p.name.trim(), StatusCode: 0, DueDate: due, RelatedEntityId: leadId, Notes: p.notes ?? "" } }),
    });
    return res.ok;
  } catch (err) {
    console.error("[leadsquared] task create failed:", errorMessage(err));
    return false;
  }
}

// Looks up the full LeadSquared lead for a phone number (first match). Tries
// +<digits> first (LSQ usually stores E.164), then bare digits, plus the last-10
// form so a lead saved WITHOUT a country code (common for Indian numbers) still
// matches the WhatsApp sender id (e.g. 91XXXXXXXXXX vs a lead saved as XXXXXXXXXX).
async function retrieveLead(phone: string, c: LsqCreds): Promise<Record<string, unknown> | null> {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const last10 = digits.length > 10 ? digits.slice(-10) : "";
  let okResponses = 0;
  for (const candidate of [`+${digits}`, digits, ...(last10 ? [`+${last10}`, last10] : [])]) {
    const url = `${c.host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&phone=${encodeURIComponent(candidate)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });   // a hung LSQ socket must not stall webhooks/cron
    if (!res.ok) continue;
    okResponses++;
    const leads = (await res.json().catch(() => [])) as Record<string, unknown>[];
    if (Array.isArray(leads) && leads[0]?.ProspectID) return leads[0];
  }
  // Every candidate was rejected (401 bad key / wrong host / 429) — that's a
  // LOOKUP FAILURE, not "no lead". Throw so activity pushes retry via the queue
  // instead of silently dropping. A genuine no-match returns null above.
  if (okResponses === 0) throw new Error("lead lookup rejected for all phone forms (check LSQ keys/host or rate limit)");
  return null;
}

// ProspectID only — the common case. Shares retrieveLead's candidate/throw logic.
async function findLeadId(phone: string, c: LsqCreds): Promise<string | null> {
  return ((await retrieveLead(phone, c))?.ProspectID as string | undefined) ?? null;
}

// Looks up the LeadSquared ProspectID by Instagram handle. Requires the tenant to
// store the handle in a lead field whose schema name is their lsq_ig_handle_field
// (e.g. mx_Instagram). Tries the bare handle and the @-prefixed form.
async function findLeadIdByHandle(handle: string, c: LsqCreds, field: string = c.igHandleField): Promise<string | null> {
  const h = (handle || "").replace(/^@/, "").trim();
  if (!field || !h) return null;
  let okResponses = 0;
  for (const value of [h, `@${h}`]) {
    try {
      const url = `${c.host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Parameter: { LookupName: field, LookupValue: value }, Paging: { PageIndex: 1, PageSize: 1 } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      okResponses++;
      const data = (await res.json().catch(() => null)) as { ProspectID?: string }[] | null;
      if (Array.isArray(data) && data[0]?.ProspectID) return data[0].ProspectID;
    } catch { /* try next candidate */ }
  }
  // Both forms rejected/unreachable = lookup FAILURE (throw → queue retry), not
  // "no lead" — mirrors findLeadId.
  if (okResponses === 0) throw new Error("handle lookup rejected for all forms (check LSQ keys/host or rate limit)");
  return null;
}

// Pulls the first phone-like number out of free text (e.g. an Instagram lead
// typing their WhatsApp number). Returns normalized digits (10-15) or null.
export function extractPhone(text: string): string | null {
  const candidates = (text || "").match(/\+?\d[\d\s().-]{8,}\d/g);
  if (!candidates) return null;
  for (const c of candidates) {
    const d = c.replace(/\D/g, "");
    if (d.length >= 10 && d.length <= 15) return d;
  }
  return null;
}

// Pulls a real phone number out of a contact's collected attributes.
export function phoneFromAttributes(attributes: Record<string, string> | null | undefined): string | null {
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (/phone|mobile|whats?app|contact|number/i.test(k) && String(v).replace(/\D/g, "").length >= 10) return String(v);
  }
  return null;
}

// The CRM picture of a lead, surfaced inside Live Chat / the profile drawer.
export interface CrmLead {
  id: string;
  stage: string | null;
  owner: string | null;
  score: number | null;
  source: string | null;
  fields: { label: string; value: string }[];
}

// ── Bulk extract (for LeadSquared-sourced drips) ─────────────────────────────
export type LeadCond = { field: string; op: "eq" | "contains" | "gt" | "lt"; value: string };
export interface ExtractedLead { phone: string; name: string }

function flattenLead(lead: Record<string, unknown>): Record<string, string> {
  const lpl = lead.LeadPropertyList as { Attribute?: string; Value?: string }[] | undefined;
  if (Array.isArray(lpl)) {
    const out: Record<string, string> = {};
    for (const p of lpl) if (p.Attribute) out[p.Attribute] = p.Value ?? "";
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead)) out[k] = v == null ? "" : String(v);
  return out;
}

function matchesCond(lead: Record<string, string>, c: LeadCond): boolean {
  const raw = lead[c.field] ?? "";
  if (raw === "" && c.op !== "eq") return false;
  const a = raw.toLowerCase().trim(), b = (c.value ?? "").toLowerCase().trim();
  switch (c.op) {
    case "eq": return a === b;
    case "contains": return a.includes(b);
    case "gt": { const na = Number(raw), nb = Number(c.value); if (!isNaN(na) && !isNaN(nb)) return na > nb; const da = Date.parse(raw), db = Date.parse(c.value); return !isNaN(da) && !isNaN(db) && da > db; }
    case "lt": { const na = Number(raw), nb = Number(c.value); if (!isNaN(na) && !isNaN(nb)) return na < nb; const da = Date.parse(raw), db = Date.parse(c.value); return !isNaN(da) && !isNaN(db) && da < db; }
  }
}

// Extracts leads matching ALL conditions. The first equals-condition anchors a
// server-side LSQ query (Leads.Get, paged); the rest filter locally.
export async function fetchLeads(conditions: LeadCond[], max = 2000, tenantId: string = DEFAULT_TENANT_ID): Promise<{ leads: ExtractedLead[]; scanned: number; truncated: boolean; error?: string }> {
  const c = await resolveLsq(tenantId);
  if (!c) return { leads: [], scanned: 0, truncated: false, error: "LeadSquared isn't set up for this workspace." };
  const anchor = conditions.find(x => x.op === "eq" && x.field.trim() && x.value.trim());
  if (!anchor) return { leads: [], scanned: 0, truncated: false, error: "Add at least one exact-match (equals) condition to anchor the search." };
  const cols = "ProspectID,FirstName,LastName,Phone,Mobile,EmailAddress,ProspectStage,Source,Owner,OwnerIdName,mx_City,CreatedOn";
  const seen = new Set<string>();
  const leads: ExtractedLead[] = [];
  let scanned = 0, truncated = false;
  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${c.host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Parameter: { LookupName: anchor.field.trim(), LookupValue: anchor.value.trim() }, Columns: { Include_CSV: cols }, Paging: { PageIndex: page, PageSize: 1000 }, Sorting: { ColumnName: "CreatedOn", Direction: "1" } }),
      });
      if (!res.ok) return { leads, scanned, truncated, error: `LeadSquared search failed (HTTP ${res.status}).` };
      const data = await res.json().catch(() => null);
      const rows = (Array.isArray(data) ? data : (data?.Leads ?? [])) as Record<string, unknown>[];
      if (!rows.length) break;
      for (const row of rows) {
        scanned++;
        const lead = flattenLead(row);
        if (!conditions.every(x => matchesCond(lead, x))) continue;
        const phone = (lead.Mobile || lead.Phone || "").replace(/\D/g, "");
        if (phone.length < 10 || seen.has(phone.slice(-10))) continue;
        seen.add(phone.slice(-10));
        leads.push({ phone, name: `${lead.FirstName ?? ""} ${lead.LastName ?? ""}`.trim() });
        if (leads.length >= max) { truncated = true; break; }
      }
      if (truncated || rows.length < 1000) break;
    }
    return { leads, scanned, truncated };
  } catch (err) {
    return { leads, scanned, truncated, error: errorMessage(err) };
  }
}

// Reads the lead's core CRM fields by phone. Returns null when the tenant has no
// CRM or the number isn't in it. Never throws.
export async function fetchLeadDetails(phone: string, tenantId: string = DEFAULT_TENANT_ID): Promise<CrmLead | null> {
  const c = await resolveLsq(tenantId);
  if (!c) return null;
  try {
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return null;
    for (const candidate of [`+${digits}`, digits]) {
      const url = `${c.host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&phone=${encodeURIComponent(candidate)}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const leads = (await res.json().catch(() => [])) as Record<string, unknown>[];
      const l = Array.isArray(leads) ? leads[0] : null;
      if (!l || !l.ProspectID) continue;
      const g = (k: string): string | null => { const v = l[k]; if (v == null) return null; const s = String(v).trim(); return s === "" || /^(null|undefined)$/i.test(s) ? null : s; };
      const scoreRaw = g("Score") ?? g("EngagementScore");
      const extras: { label: string; value: string }[] = [];
      for (const [key, label] of [["Company", "Company"], ["mx_City", "City"], ["mx_Course", "Course"], ["ProspectStageReason", "Stage reason"], ["Notes", "Notes"]] as const) {
        const v = g(key);
        if (v) extras.push({ label, value: v.slice(0, 200) });
      }
      return {
        id: String(l.ProspectID),
        stage: g("ProspectStage"),
        owner: g("OwnerIdName") ?? g("Owner") ?? g("OwnerName"),
        score: scoreRaw != null && !isNaN(Number(scoreRaw)) ? Number(scoreRaw) : null,
        source: g("Source"),
        fields: extras,
      };
    }
    return null;
  } catch (err) {
    console.error("[leadsquared] lead lookup failed:", errorMessage(err));
    return null;
  }
}

// ── Push plumbing: try-now, queue on retriable failure ────────────────────────

export interface WaActivityInput {
  phone: string;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent" | "crm" | "campaign";
  tenantId?: string;
  // Lead SOURCE for an auto-created lead (first inbound only). Set from the
  // click-to-chat tracked link's [ref:CODE] → Handle Hub source label, so a
  // WhatsApp chat opened from a paid ad lands in the CRM under that campaign's
  // source (e.g. "ppc-whatsapp") instead of the generic "WhatsApp". Organic
  // chats leave this unset. Existing leads keep their original source untouched.
  source?: string;
  // Name for an auto-created lead (first inbound only) — the WhatsApp profile
  // name, so a brand-new lead isn't created as "No Name". Existing leads keep
  // their name; a later flow-captured name backfills via syncLeadProfile.
  name?: string;
}

export interface ChatActivityInput {
  phone?: string | null;
  handle?: string | null;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent";
  channel: string;                 // "Instagram" | "Messenger" | "Web chat"
  tenantId?: string;
  source?: string;                 // ad-origin source for an auto-created lead (defaults to channel)
}

// `skipped` marks "this tenant's LSQ credentials did not resolve" — which is
// EITHER "tenant has no CRM" (common, benign) or a transient resolve failure
// (integrations-table blip, broken secret decrypt). The two are indistinguishable
// here, so the try-now path treats it as a no-op while the DRAIN treats it as
// retriable: queued rows only exist because creds once resolved, so deleting
// them on a resolve failure would silently destroy the backlog.
type PushResult = { ok: true; skipped?: true } | { ok: false; retriable: boolean; error: string };

// Statuses worth retrying: auth (fixable keys), timeout, rate limit, LSQ down.
// 400/404 are permanent (bad payload / deleted lead) — retrying can't help.
const RETRIABLE_HTTP = new Set([401, 403, 408, 429, 500, 502, 503, 504]);

async function postActivity(c: LsqCreds, leadId: string, note: string): Promise<PushResult> {
  try {
    const res = await fetch(`${c.host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: c.activityCode, ActivityNote: note }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, retriable: RETRIABLE_HTTP.has(res.status), error: `HTTP ${res.status} (lead ${leadId}, event ${c.activityCode}): ${detail}` };
  } catch (err) {
    return { ok: false, retriable: true, error: errorMessage(err) };   // network — always retriable
  }
}

// One attempt at a WhatsApp timeline push for the payload's tenant. A tenant
// with LSQ unconfigured/disconnected is a clean no-op (queued rows just drain).
async function tryWaActivity(p: WaActivityInput): Promise<PushResult> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const c = await resolveLsq(tid);
  if (!c) return { ok: true, skipped: true };
  try {
    let leadId = await findLeadId(p.phone, c);
    if (!leadId && p.direction === "inbound" && c.autoCreate) {
      if (!plausiblePhone(p.phone)) return { ok: true };   // fake/typo number → not a real lead; don't queue it to death
      leadId = await createOrUpdateLead({ phone: p.phone, source: p.source || "WhatsApp", name: p.name }, tid);
      // A create that answered null is a FAILURE (Lead.Capture rejected, keys
      // broken), not "phone not in CRM" — treating it as ok silently drops
      // brand-new leads. Park it; the queue replay re-runs the whole attempt.
      if (!leadId) return { ok: false, retriable: true, error: "lead auto-create returned null (Lead.Capture rejected / LSQ keys?)" };
    }
    if (!leadId) return { ok: true }; // phone not in CRM — nothing to attach to

    const arrow = p.direction === "inbound" ? "⬅️ Lead"
      : "➡️ " + (p.via === "bot" ? "AI Assistant" : p.via === "crm" ? "Sales (CRM)" : p.via === "campaign" ? "Campaign" : "Agent");
    return await postActivity(c, leadId, `${arrow}: ${p.body}`.slice(0, 1800));
  } catch (err) {
    return { ok: false, retriable: true, error: errorMessage(err) };
  }
}

// Fire-and-forget for callers: records one WhatsApp message on the lead's
// timeline. Never throws — CRM sync must not break message delivery. A
// retriably-failed push parks in wa_crm_sync (0077) and the cron replays it;
// the failure is also stamped on the tenant's integration so Settings shows it.
export async function pushWaActivity(p: WaActivityInput): Promise<void> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const r = await tryWaActivity(p);   // resolves creds once; skipped = no CRM for this tenant
  if (r.ok) return;
  console.error(`[leadsquared] activity push failed (${r.retriable ? "queued for retry" : "permanent, dropped"}): ${r.error}`);
  await noteLsqFailure(tid, r.error);
  if (r.retriable) await enqueueCrmSync("wa", { ...p, tenantId: tid }, r.error);
}

// Generic CRM timeline push for the no-native-phone channels (Instagram /
// Messenger / Web chat). The lead is resolved by a known phone first (shared in
// chat / captured by a flow), then by handle (Instagram, needs the tenant's
// lsq_ig_handle_field). The note is labelled with the channel. Never throws, and
// records the failure on the integration so it's visible in Settings.
async function tryChatActivity(p: ChatActivityInput): Promise<PushResult> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const c = await resolveLsq(tid);
  if (!c) return { ok: true, skipped: true };
  try {
    let leadId: string | null = null;
    if (p.phone) leadId = await findLeadId(p.phone, c);
    if (!leadId && p.handle) leadId = await findLeadIdByHandle(p.handle, c);
    if (!leadId && p.phone && p.direction === "inbound" && c.autoCreate) {
      if (!plausiblePhone(p.phone)) return { ok: true };   // fake/typo number → not a real lead; don't queue it to death
      leadId = await createOrUpdateLead({ phone: p.phone, name: p.handle ?? undefined, source: p.source || p.channel }, tid);
      // Same rule: a null create is a retriable failure, not "no lead".
      if (!leadId) return { ok: false, retriable: true, error: "lead auto-create returned null (Lead.Capture rejected / LSQ keys?)" };
    }
    if (!leadId) return { ok: true }; // can't match this contact to a CRM lead — skip

    const who = p.via === "bot" ? "AI Assistant" : p.via === "agent" ? "Agent" : "Sales";
    const arrow = p.direction === "inbound" ? `⬅️ Lead (${p.channel})` : `➡️ ${who} (${p.channel})`;
    return await postActivity(c, leadId, `${arrow}: ${p.body}`.slice(0, 1800));
  } catch (err) {
    return { ok: false, retriable: true, error: errorMessage(err) };
  }
}

export async function pushChatActivity(p: ChatActivityInput): Promise<void> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const r = await tryChatActivity(p);   // resolves creds once; skipped = no CRM for this tenant
  if (r.ok) return;
  console.error(`[leadsquared] ${p.channel} activity push failed (${r.retriable ? "queued for retry" : "permanent, dropped"}): ${r.error}`);
  await noteLsqFailure(tid, r.error);
  if (r.retriable) await enqueueCrmSync("chat", { ...p, tenantId: tid }, r.error);
}

// Instagram convenience wrapper — kept for existing callers.
export async function pushIgActivity(p: {
  igUserId: string;
  handle?: string | null;
  phone?: string | null;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent";
  tenantId?: string;
}): Promise<void> {
  return pushChatActivity({ phone: p.phone, handle: p.handle, direction: p.direction, body: p.body, via: p.via, channel: "Instagram", tenantId: p.tenantId });
}

// ── CRM sync queue (wa_crm_sync, 0077) ────────────────────────────────────────
// Failed-retriable pushes park here; drainCrmSync (per-minute cron) replays with
// exponential backoff, deletes on success, dead-letters after the cap. Campaign
// blasts enqueue directly so thousands of sends never stampede LSQ's rate limits
// — the drain paces them. Rows carry tenant_id and the payload carries tenantId,
// so a replay resolves that tenant's own LSQ credentials.

const CRM_SYNC_MAX_ATTEMPTS = 8;
const CRM_SYNC_BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440];   // minutes by attempt #

// Queue one push for the drain. Swallows DB errors (a missing table must never
// break message handling) but says why, loudly.
export async function enqueueCrmSync(kind: "wa" | "chat", payload: WaActivityInput | ChatActivityInput, error?: string): Promise<void> {
  try {
    const { error: dbErr } = await db().from("wa_crm_sync").insert({
      tenant_id: payload.tenantId ?? DEFAULT_TENANT_ID, kind, payload,
      last_error: error?.slice(0, 500) ?? null,
      next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (dbErr) throw dbErr;
  } catch (err) {
    console.error(`[leadsquared] could not queue CRM sync (migration 0077 applied?): ${errorMessage(err)}`);
  }
}

// Batch enqueue (campaign sends) — one insert per 500 rows, due immediately.
// Callers should skip entirely when the tenant has no LSQ (see sendCampaign).
export async function enqueueCrmSyncBatch(rows: { kind: "wa" | "chat"; payload: WaActivityInput | ChatActivityInput }[]): Promise<void> {
  if (!rows.length) return;
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const { error: dbErr } = await db().from("wa_crm_sync").insert(
        rows.slice(i, i + 500).map(r => ({ tenant_id: r.payload.tenantId ?? DEFAULT_TENANT_ID, kind: r.kind, payload: r.payload })),
      );
      if (dbErr) throw dbErr;
    }
  } catch (err) {
    console.error(`[leadsquared] could not batch-queue CRM sync (migration 0077 applied?): ${errorMessage(err)}`);
  }
}

// Replay due queue rows across ALL tenants (each payload resolves its own
// tenant's creds; a tenant that disconnected LSQ drains as a clean no-op).
// Paced (default 100/tick); soft-claims each row (CAS on next_attempt_at, like
// sequences) so overlapping cron ticks don't double-post. Prunes dead rows
// older than 14 days.
export async function drainCrmSync(limit = 100, deadlineAt?: number): Promise<{ replayed: number; deferred: number; dead: number }> {
  let replayed = 0, deferred = 0, dead = 0;
  try {
    const { data, error } = await db().from("wa_crm_sync")
      .select("*").eq("status", "pending").lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at").limit(limit);
    if (error) throw error;

    for (const row of (data ?? []) as { id: string; kind: string; payload: unknown; attempts: number; next_attempt_at: string }[]) {
      if (deadlineAt && Date.now() > deadlineAt) break;
      // Soft claim — only the tick that still sees the exact next_attempt_at wins.
      const lease = new Date(Date.now() + 5 * 60_000).toISOString();
      const claimed = await db().from("wa_crm_sync")
        .update({ next_attempt_at: lease })
        .eq("id", row.id).eq("status", "pending").eq("next_attempt_at", row.next_attempt_at)
        .select("id");
      if (!claimed.data?.length) continue;

      const raw = row.kind === "chat"
        ? await tryChatActivity(row.payload as ChatActivityInput)
        : await tryWaActivity(row.payload as WaActivityInput);

      // A queued row only exists because this tenant's creds once resolved — a
      // resolve failure at replay time must NOT delete it (it's either a
      // transient infra blip or a deliberate disconnect; retry, then dead-letter).
      const r: PushResult = raw.ok && raw.skipped
        ? { ok: false, retriable: true, error: "LSQ credentials did not resolve (disconnected or transient) — will retry" }
        : raw;

      if (r.ok) {
        const del = await db().from("wa_crm_sync").delete().eq("id", row.id);
        // A failed delete leaves the row leased → it replays in ~5 min → a
        // duplicate timeline note. Can't do better without idempotency keys on
        // LSQ's side; log it so duplicates are explainable.
        if (del.error) console.error(`[leadsquared] CRM sync replayed but delete failed (row ${row.id} will duplicate): ${del.error.message}`);
        replayed++;
        continue;
      }
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= CRM_SYNC_MAX_ATTEMPTS || !r.retriable) {
        await db().from("wa_crm_sync").update({ status: "dead", attempts, last_error: r.error.slice(0, 500) }).eq("id", row.id);
        console.error(`[leadsquared] CRM sync dead-lettered after ${attempts} attempt(s): ${r.error}`);
        dead++;
      } else {
        const mins = CRM_SYNC_BACKOFF_MIN[Math.min(attempts, CRM_SYNC_BACKOFF_MIN.length - 1)];
        await db().from("wa_crm_sync").update({
          attempts, last_error: r.error.slice(0, 500),
          next_attempt_at: new Date(Date.now() + mins * 60_000).toISOString(),
        }).eq("id", row.id);
        deferred++;
      }
    }

    // Housekeeping: dead rows are kept 14 days for inspection, then pruned.
    await db().from("wa_crm_sync").delete().eq("status", "dead")
      .lt("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  } catch (err) {
    console.error("[leadsquared] drainCrmSync failed:", errorMessage(err));
  }
  return { replayed, deferred, dead };
}

// Queue health: how much is waiting / dead (optionally for one tenant).
export async function crmSyncStats(tenantId?: string): Promise<{ pending: number; dead: number; broken?: string }> {
  try {
    const base = () => {
      let q = db().from("wa_crm_sync").select("id", { count: "exact", head: true });
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    };
    const [p, d] = await Promise.all([base().eq("status", "pending"), base().eq("status", "dead")]);
    return { pending: p.count ?? 0, dead: d.count ?? 0 };
  } catch (err) { return { pending: 0, dead: 0, broken: errorMessage(err) }; }
}
