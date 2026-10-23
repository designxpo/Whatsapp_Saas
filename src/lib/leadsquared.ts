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
import { lsqApiHost } from "./lsqhost";
import { pageAll } from "./pagedselect";
import { crmChatKey, type ChatCrmStatus } from "./crmkey";
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
  const host = lsqApiHost(process.env.LSQ_API_HOST);
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
      const host = lsqApiHost(cfg.host);   // anything not LeadSquared reads as unset (lsqhost.ts)
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
    const host = lsqApiHost(await getTenantSetting<string | null>(tenantId, LSQ_KEYS.host, null));
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

// How long a WhatsApp/chat session must go quiet before flushCrmSessions
// combines its buffered messages into ONE LeadSquared activity — instead of
// every message posting its own note, which turned a 6-question qualification
// flow into 12+ tiny timeline entries.
const SESSION_GAP_MS = Math.max(1, parseInt(process.env.LSQ_SESSION_GAP_MINUTES ?? "10", 10)) * 60_000;
const SESSION_NOTE_CAP = 8000;
// A buffered session holds real customer messages that exist NOWHERE in the CRM
// yet, so a failing flush must never throw them away — it backs off instead and
// keeps the row until it lands. Minutes by attempt number, then hourly-ish.
const SESSION_BACKOFF_MIN = [5, 15, 60, 180, 360, 720, 1440];

// Read-only connectivity check for the Setup wizard. RetrieveLeadByPhoneNumber
// with a dummy number NEVER creates data — a 200 (even empty) means the keys +
// host are valid; 401/403 means bad keys. Honours "do not create test leads".
export async function verifyLsq(tenantId: string = DEFAULT_TENANT_ID): Promise<{ ok: boolean; detail: string }> {
  const c = await resolveLsq(tenantId);
  if (!c) return { ok: false, detail: "LeadSquared isn't set up for this workspace yet — add your keys in Settings." };
  try {
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&phone=${encodeURIComponent("+10000000000")}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      // Reading is not writing: LSQ serves lead lookups happily while rejecting
      // every activity Create (e.g. the custom activity type was deactivated so
      // the event code no longer resolves).
      const { held, lastError } = await crmSessionStats(tenantId);
      if (held > 0 && lastError) {
        return { ok: false, detail: `Connected, but timeline pushes are FAILING — ${held} conversation(s) buffered and unsent. LeadSquared says: ${lastError}` };
      }
      return { ok: true, detail: "Connected — your LeadSquared keys work." };
    }
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
  if (await lsqPaused(tenantId)) return;
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

export async function setLeadField(leadId: string, attribute: string, value: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  const c = await resolveLsq(tenantId);
  if (!c || !leadId || !attribute.trim()) return false;
  try {
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Update?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&leadId=${encodeURIComponent(leadId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ Attribute: attribute.trim(), Value: value }]),
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
  ownerEmail: string | null;   // OwnerIdEmailAddress — the join key to a portal member (handover.ts)
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
        ownerEmail: (g("OwnerIdEmailAddress") ?? g("OwnerEmailAddress"))?.toLowerCase() ?? null,
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

// LeadSquared does NOT use HTTP status to separate "our fault" from "your input
// is wrong": a rejected ActivityEvent comes back as HTTP 500 with an MXException
// body, and some rejections come back as HTTP 200 with {"Status":"Failed"}. Read
// as success-or-retry, that is how deactivating a tenant's custom activity type
// silently destroyed a day of conversations on the internal build.
function lsqRejectedInput(body: string): boolean {
  return /IsMXException|MXInvalidActivityException|Invalid event code|invalid or empty|"Status"\s*:\s*"(Failed|Error)"/i.test(body);
}

// Narrower than lsqRejectedInput: LeadSquared is rejecting the LEAD we pointed
// at, not the request. Deleting a lead in the CRM leaves every buffered session
// for it failing with this forever, and unlike a bad event code there is
// nothing a person can fix — the destination is gone.
//
// Kept separate from lsqRejectedInput on purpose. A deactivated activity type
// rejects pushes for leads that genuinely exist, so the two must never be
// conflated: one is recoverable and waits, the other is terminal.
function lsqLeadMissing(body: string): boolean {
  return /MXInvalidEntityReference|Lead\s*not\s*found/i.test(body);
}

/**
 * Does LeadSquared hold a lead for this phone — and did we actually find out?
 *
 * getLeadIdByPhone answers null for BOTH "no such lead" and "the lookup was
 * refused". That conflation is harmless when the answer only gates a retry, and
 * dangerous the moment it gates a discard: a mis-escaped key or a rate-limit
 * spike would read as "this person isn't in the CRM" and bin real chat history.
 *
 * So this keeps the distinction findLeadId already makes. `known` is false when
 * every candidate form was rejected, and the caller must then assume nothing.
 */
async function lookupLeadDefinitively(phone: string, c: LsqCreds): Promise<{ known: boolean; leadId: string | null }> {
  try {
    return { known: true, leadId: await findLeadId(phone, c) };
  } catch {
    return { known: false, leadId: null };   // 401 / 429 / unreachable — not an answer
  }
}

async function postActivity(c: LsqCreds, leadId: string, note: string): Promise<PushResult> {
  try {
    const res = await fetch(`${c.host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: c.activityCode, ActivityNote: note }),
      signal: AbortSignal.timeout(8000),
    });
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    // A 2xx is only a real success if LSQ didn't put a failure in the body.
    if (res.ok && !lsqRejectedInput(detail)) return { ok: true };
    const retriable = res.ok ? false : RETRIABLE_HTTP.has(res.status) && !lsqRejectedInput(detail);
    return { ok: false, retriable, error: `HTTP ${res.status} (lead ${leadId}, event ${c.activityCode}): ${detail}` };
  } catch (err) {
    return { ok: false, retriable: true, error: errorMessage(err) };   // network — always retriable
  }
}

// Append one line to a lead's session buffer (wa_crm_session, 0098) instead of
// posting it as its own LeadSquared activity — flushCrmSessions combines the
// whole session into one note once it goes quiet. Optimistic-concurrency CAS
// retry (on last_message_at) so two messages for the same lead landing at
// nearly the same time can't clobber each other's append (lost-update).
async function bufferSessionLine(kind: "wa" | "chat", phone: string, channel: string, tenantId: string, leadId: string, line: string): Promise<PushResult> {
  const key = { kind, phone, channel, tenant_id: tenantId };
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db().from("wa_crm_session").select("id, lines, last_message_at").match(key).maybeSingle();
      if (existing.error) throw existing.error;
      const now = new Date().toISOString();
      if (existing.data) {
        const lines = [...((existing.data.lines as string[]) ?? []), line];
        const upd = await db().from("wa_crm_session")
          .update({ lines, lead_id: leadId, last_message_at: now })
          .eq("id", existing.data.id).eq("last_message_at", existing.data.last_message_at as string)
          .select("id");
        if (upd.error) throw upd.error;
        if (upd.data?.length) return { ok: true };   // won the race
        continue;   // someone else (a concurrent message, or a flush lease) updated it first — retry with fresh data
      }
      const ins = await db().from("wa_crm_session").insert({ kind, phone, channel, tenant_id: tenantId, lead_id: leadId, lines: [line] });
      if (!ins.error) return { ok: true };
      // Likely a unique-violation (another concurrent insert won) — loop back
      // and pick it up as an update instead.
    }
    return { ok: false, retriable: true, error: "session buffer write contention (gave up after 5 attempts)" };
  } catch (err) {
    return { ok: false, retriable: true, error: `session buffer write failed: ${errorMessage(err)}` };
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
    return await bufferSessionLine("wa", p.phone.replace(/\D/g, ""), "", tid, leadId, `${arrow}: ${p.body}`.slice(0, 1800));
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
  // Paused: park it rather than attempt. Attempting would still create the lead.
  // Only for a tenant that HAS a CRM — a workspace with none must not fill the
  // retry queue with rows that can never be delivered.
  if (await lsqPaused(tid)) { if (await lsqConfigured(tid)) await enqueueCrmSync("wa", { ...p, tenantId: tid }, "sync paused"); return; }
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
    const bufferPhone = p.phone ? p.phone.replace(/\D/g, "") : `handle:${p.handle}`;   // phone-less IG lead keyed by handle
    return await bufferSessionLine("chat", bufferPhone, p.channel, tid, leadId, `${arrow}: ${p.body}`.slice(0, 1800));
  } catch (err) {
    return { ok: false, retriable: true, error: errorMessage(err) };
  }
}

export async function pushChatActivity(p: ChatActivityInput): Promise<void> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  if (await lsqPaused(tid)) { if (await lsqConfigured(tid)) await enqueueCrmSync("chat", { ...p, tenantId: tid }, "sync paused"); return; }
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
  source?: string;                 // per-channel CRM lead source (defaults to "Instagram")
}): Promise<void> {
  return pushChatActivity({ phone: p.phone, handle: p.handle, direction: p.direction, body: p.body, via: p.via, channel: "Instagram", tenantId: p.tenantId, source: p.source });
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
    // A paused tenant's rows stay queued untouched: excluded here, in the query,
    // so they cannot crowd the batch (see pausedTenantIds).
    const paused = await pausedTenantIds();
    let due = db().from("wa_crm_sync")
      .select("*").in("kind", ["wa", "chat"]).eq("status", "pending").lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at").limit(limit);   // kind filter: integrations park their own deliveries here (kind 'integration')
    if (paused.length) due = due.not("tenant_id", "in", `(${paused.join(",")})`);
    const { data, error } = await due;
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
    await db().from("wa_crm_sync").delete().in("kind", ["wa", "chat"]).eq("status", "dead")
      .lt("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  } catch (err) {
    console.error("[leadsquared] drainCrmSync failed:", errorMessage(err));
  }
  return { replayed, deferred, dead };
}

// ── CRM session batching (wa_crm_session, 0098) ───────────────────────────────
// Combines a lead's buffered messages into ONE LeadSquared activity once the
// session has gone quiet for SESSION_GAP_MS. Soft-claims each row (lease the
// last_message_at forward) so an overlapping cron tick — or a genuinely new
// message arriving mid-post — can't cause a double-post; on success the row is
// deleted ONLY if nothing new landed while we were posting (a second CAS on
// the lease), so a message that arrives mid-flush is never silently lost —
// worst case it re-posts the already-flushed lines alongside it on the NEXT
// flush (a rare, explainable duplicate, never silent data loss). Spans ALL
// tenants like drainCrmSync — each row resolves its own tenant's LSQ creds.
export async function flushCrmSessions(limit = 100, deadlineAt?: number): Promise<{ flushed: number; deferred: number; discarded: number }> {
  let flushed = 0, deferred = 0, discarded = 0;
  const perTenant = new Map<string, { flushed: number; deferred: number; discarded: number; lastError: string }>();
  const tally = (tid: string, key: "flushed" | "deferred" | "discarded", err = "") => {
    const t = perTenant.get(tid) ?? { flushed: 0, deferred: 0, discarded: 0, lastError: "" };
    t[key]++; if (err) t.lastError = err;
    perTenant.set(tid, t);
  };
  try {
    const cutoff = new Date(Date.now() - SESSION_GAP_MS).toISOString();
    // Only rows still owed to the CRM. A discarded row (status, see the parity
    // migration) is terminal — its lead was deleted — and re-reading it every
    // tick is what kept the health bar red.
    // Paused tenants' sessions keep buffering — excluded in the query so they
    // cannot crowd the batch (see pausedTenantIds).
    const paused = await pausedTenantIds();
    const excludePaused = <T extends { not: (c: string, op: string, v: string) => T }>(q: T): T =>
      paused.length ? q.not("tenant_id", "in", `(${paused.join(",")})`) : q;
    let { data, error } = await excludePaused(db().from("wa_crm_session")
      .select("*").eq("status", "pending").lte("last_message_at", cutoff).order("last_message_at").limit(limit));
    if (error && isMissingColumn(error)) {
      ({ data, error } = await excludePaused(db().from("wa_crm_session")   // status column not applied yet
        .select("*").lte("last_message_at", cutoff).order("last_message_at").limit(limit)));
    }
    if (error) throw error;

    for (const row of (data ?? []) as { id: string; tenant_id: string; lead_id: string; phone: string; lines: string[]; attempts: number; last_message_at: string }[]) {
      if (deadlineAt && Date.now() > deadlineAt) break;
      const lease = new Date(Date.now() + 5 * 60_000).toISOString();
      const claim = await db().from("wa_crm_session")
        .update({ last_message_at: lease })
        .eq("id", row.id).eq("last_message_at", row.last_message_at).select("id");
      if (!claim.data?.length) continue;   // another tick already claimed it, or a new message just extended the session

      // A tenant whose LSQ creds don't resolve (disconnected, or a transient
      // blip) — leave it leased; it retries on a later tick like drainCrmSync
      // treats the same ambiguity.
      const c = await resolveLsq(row.tenant_id);
      if (!c) { deferred++; tally(row.tenant_id, "deferred"); continue; }

      let note = row.lines.join("\n");
      if (note.length > SESSION_NOTE_CAP) note = "…[earlier messages truncated]…\n" + note.slice(-SESSION_NOTE_CAP);
      let r = await postActivity(c, row.lead_id, note);

      // A PERMANENT rejection is usually a dead RelatedProspectId, not a bad
      // note. lead_id is captured when the FIRST message of a session arrives
      // and reused at flush time, which can be hours later — and LeadSquared
      // merges duplicate leads (a Meta lead-form integration creates a second
      // lead for the same phone). A merge keeps one ProspectID and discards the
      // other, and if ours was the discarded one every push for that session
      // fails forever. Re-resolve and retry ONCE. Only on the non-retriable
      // path, so the happy case costs no extra LeadSquared call.
      //
      // A merge leaves a different LIVE id behind and the retry lands. A DELETE
      // leaves nothing at all, and that is the terminal case below.
      let destinationGone = false;
      if (!r.ok && !r.retriable) {
        const { known, leadId: fresh } = await lookupLeadDefinitively(row.phone, c);
        if (fresh && fresh !== row.lead_id) {
          console.warn(`[leadsquared] stale lead id for ${row.phone.slice(-4)} — LSQ now resolves it to a different lead; retrying`);
          const retry = await postActivity(c, fresh, note);
          if (retry.ok) {
            // Persist it so the next line of this conversation stops using the dead id.
            await db().from("wa_crm_session").update({ lead_id: fresh }).eq("id", row.id).then(() => {}, () => {});
            r = retry;
          }
        }
        // Both facts, independently, before anything is given up on: LSQ
        // rejected the LEAD REFERENCE, and a lookup that genuinely answered
        // found nobody. Either alone is not enough.
        destinationGone = known && !fresh && lsqLeadMissing(r.ok ? "" : r.error);
      }

      if (r.ok) {
        const del = await db().from("wa_crm_session").delete().eq("id", row.id).eq("last_message_at", lease);
        if (del.error) console.error(`[leadsquared] session flush posted but delete failed (row ${row.id} may duplicate): ${del.error.message}`);
        flushed++;
        tally(row.tenant_id, "flushed");
        continue;
      }

      // ── Terminal: the lead this session belongs to no longer exists ──────
      //
      // Holding assumes somebody can eventually fix the CRM and the backlog
      // will drain. That fails completely for a DELETED lead: there is no
      // config to repair and no id to retry against, so the row would sit in
      // the live queue forever holding the health bar red — and "Retry now"
      // clears `attempts`, so every click restarted the ramp and the same
      // error came straight back.
      //
      // Marked, never deleted: the lines stay on the row for inspection (and
      // the 14-day prune below eventually clears them), so this is a terminal
      // STATE, not data loss.
      if (destinationGone) {
        const gone = await db().from("wa_crm_session").update({
          status: "discarded",
          last_error: (r.error ?? "lead no longer exists in LeadSquared").slice(0, 500),
          last_attempt_at: new Date().toISOString(),
        }).eq("id", row.id).eq("last_message_at", lease);
        if (gone.error && isMissingColumn(gone.error)) {
          // Migration not applied — fall through to the ordinary hold rather
          // than leave the row leased and unreachable.
          console.error("[leadsquared] cannot discard a deleted-lead session — apply 20261019000000_port_wab_parity.sql");
        } else {
          console.warn(`[leadsquared] session for ${row.phone.slice(-4)} discarded — LeadSquared has no lead for this number and the one it was buffered against is gone`);
          discarded++;
          tally(row.tenant_id, "discarded");
          continue;
        }
      }

      // HOLD, never delete. Deleting on failure is what turned a deactivated
      // LeadSquared activity type into silent data loss: every push failed, the
      // cap was reached, and a day of real conversations was dropped while the
      // connectivity check still read green. Held rows cost nothing and
      // re-flush by themselves the moment the tenant's CRM side is fixed.
      const attempts = (row.attempts ?? 0) + 1;
      // A permanent rejection means LeadSquared is refusing the request itself
      // (bad/deactivated event code), which only a human fixing that tenant's
      // CRM config can clear — hold at the slowest tier rather than re-asking
      // every few minutes. Transient faults keep the gentle ramp.
      const tier = r.retriable ? Math.min(attempts - 1, SESSION_BACKOFF_MIN.length - 1) : SESSION_BACKOFF_MIN.length - 1;
      const nextAt = new Date(Date.now() + SESSION_BACKOFF_MIN[tier] * 60_000).toISOString();
      console.error(`[leadsquared] session flush held (attempt ${attempts}, retrying in ${SESSION_BACKOFF_MIN[tier]}m): ${r.error}`);
      // Persist the reason ON THE ROW. It used to live only in the per-tick
      // health record, which any successful flush overwrote — so the
      // explanation for a permanently-stuck row vanished the moment an
      // unrelated lead pushed fine.
      const holdRow: Record<string, unknown> = {
        attempts, last_message_at: nextAt,
        last_error: (r.error ?? "unknown error").slice(0, 500),
        last_attempt_at: new Date().toISOString(),
      };
      let heldUpd = await db().from("wa_crm_session").update(holdRow).eq("id", row.id).eq("last_message_at", lease);
      if (heldUpd.error && isMissingColumn(heldUpd.error)) {
        // Columns not applied yet — the hold itself must still happen, or the
        // row keeps its lease timestamp and never becomes due again.
        delete holdRow.last_error; delete holdRow.last_attempt_at;
        heldUpd = await db().from("wa_crm_session").update(holdRow).eq("id", row.id).eq("last_message_at", lease);
      }
      if (heldUpd.error) console.error(`[leadsquared] could not record the hold for row ${row.id}: ${heldUpd.error.message}`);
      deferred++;
      tally(row.tenant_id, "deferred", r.error ?? "unknown error");
    }

    // Housekeeping, as wa_crm_sync does for its dead rows: a discarded session
    // is kept for a fortnight so the decision can be inspected, then pruned.
    await db().from("wa_crm_session").delete().eq("status", "discarded")
      .lt("last_attempt_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
      .then(() => {}, () => {});
  } catch (err) {
    console.error("[leadsquared] flushCrmSessions failed:", errorMessage(err));
  }
  for (const [tid, t] of perTenant) await recordSessionFlushHealth(tid, t);
  return { flushed, deferred, discarded };
}

// 42703 = Postgres undefined_column, PGRST204 = PostgREST's schema-cache miss.
// Either means "a migration this code knows about has not been applied yet".
function isMissingColumn(e: { code?: string } | null | undefined): boolean {
  return e?.code === "42703" || e?.code === "PGRST204";
}

// Write-path health, per tenant. verifyLsq only proves we can READ from
// LeadSquared, which is why it stayed green through a total write outage.
// Persist the last flush result so the status surface can say that pushes are
// failing, and why. Best-effort: a settings write must never break the flush.
async function recordSessionFlushHealth(tenantId: string, t: { flushed: number; deferred: number; discarded: number; lastError: string }): Promise<void> {
  const now = new Date().toISOString();
  try {
    // Carry the previous lastOkAt forward. `at` moves on every attempt, so it
    // answers "when did we last try", not "when did a push last SUCCEED" — and
    // during an outage the difference between those two is the whole story.
    // Only a flush that actually delivered something advances lastOkAt.
    const prev = await db().from("wa_settings").select("value").eq("tenant_id", tenantId).eq("key", "crm_session_flush_health").maybeSingle();
    const carried = ((prev.data?.value ?? {}) as { lastOkAt?: string }).lastOkAt ?? null;
    await db().from("wa_settings").upsert({
      tenant_id: tenantId, key: "crm_session_flush_health",
      value: { at: now, flushed: t.flushed, deferred: t.deferred, discarded: t.discarded, lastError: t.lastError.slice(0, 400), lastOkAt: t.flushed > 0 ? now : carried },
      updated_at: now,
    }, { onConflict: "tenant_id,key" });
  } catch { /* diagnostic only */ }
}

// How many of this tenant's buffered sessions are stuck, and why.
export async function crmSessionStats(tenantId: string = DEFAULT_TENANT_ID): Promise<{ held: number; lastError: string; heldSince: string | null }> {
  let held = 0;
  // Per-row reason — the DURABLE copy. Read in its own try so a missing column,
  // or anything else going wrong here, degrades to the settings row below
  // instead of losing the error entirely.
  let rowError = "", heldSince: string | null = null;
  try {
    // `status` excludes rows discarded because their lead was deleted. Those are
    // terminal and need nobody, so counting them is what kept the bar red with an
    // error that could never clear.
    const scoped = await db().from("wa_crm_session")
      .select("last_error, created_at").eq("tenant_id", tenantId).eq("status", "pending").gt("attempts", 0)
      .order("created_at", { ascending: true }).limit(1);
    let data: { last_error?: string | null; created_at?: string }[] | null = scoped.data;
    if (scoped.error && isMissingColumn(scoped.error)) {
      ({ data } = await db().from("wa_crm_session")   // pre-migration: neither status nor last_error exists
        .select("created_at").eq("tenant_id", tenantId).gt("attempts", 0)
        .order("created_at", { ascending: true }).limit(1));
    }
    const oldest = (data ?? [])[0] as { last_error?: string | null; created_at?: string } | undefined;
    rowError = oldest?.last_error ?? "";
    heldSince = oldest?.created_at ?? null;
  } catch { /* an unavailable table — fall through */ }

  // Count, plus the per-tick error as a FALLBACK only. That settings row is
  // rewritten by every flush tick that had work, so one successful push for a
  // fresh lead blanks it — which is how nine permanently-unsent conversations
  // read as healthy. The row copy above outranks it.
  let tickError = "";
  try {
    const [pendingHeld, { data }] = await Promise.all([
      db().from("wa_crm_session").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending").gt("attempts", 0),
      db().from("wa_settings").select("value").eq("tenant_id", tenantId).eq("key", "crm_session_flush_health").maybeSingle(),
    ]);
    held = pendingHeld.error && isMissingColumn(pendingHeld.error)
      ? ((await db().from("wa_crm_session").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gt("attempts", 0)).count ?? 0)
      : (pendingHeld.count ?? 0);
    tickError = ((data?.value ?? {}) as { lastError?: string }).lastError ?? "";
  } catch { return { held, lastError: rowError, heldSince }; }

  return { held, lastError: rowError || tickError, heldSince };
}

export interface CrmPushHealth {
  configured: boolean;
  state: "ok" | "syncing" | "failing" | "off";
  pending: number;     // queued, will retry on its own
  dead: number;        // permanently failed — needs a person
  held: number;        // conversations buffered with a failed attempt behind them
  lastOkAt: string | null;
  lastError: string;
  detail: string;      // one sentence for a human
}

// Whether chat data is actually reaching LeadSquared right now, for one tenant.
//
// DB reads ONLY — no network. verifyLsq() probes LeadSquared over HTTP, which is
// fine for a settings page but far too heavy for a bar that polls while someone
// works the inbox. It also answers the wrong question: it proves we can READ
// from LeadSquared, and it stayed green through a total WRITE outage. What
// matters here is whether pushes are landing, which is what these counters
// record.
export async function crmPushHealth(tenantId: string = DEFAULT_TENANT_ID): Promise<CrmPushHealth> {
  if (!await lsqConfigured(tenantId)) {
    return { configured: false, state: "off", pending: 0, dead: 0, held: 0, lastOkAt: null, lastError: "",
             detail: "LeadSquared isn't configured, so nothing is being pushed." };
  }
  const [queue, session] = await Promise.all([crmSyncStats(tenantId), crmSessionStats(tenantId)]);
  const { pending, dead } = queue;
  const { held, lastError } = session;
  const lastOkAt = await lastSuccessfulPushAt(tenantId);

  // A held conversation WITH an error behind it means LeadSquared is rejecting
  // writes; dead rows mean pushes were abandoned. Either is a real failure a
  // person has to act on, so they outrank a mere backlog.
  // A row still held after an hour has already been through the gentle backoff
  // ramp, so it is not "retrying automatically" in any useful sense — it is
  // stuck. Treating it as a backlog is how a dead write path reported "syncing"
  // while nothing moved for a week.
  const STUCK_MS = 60 * 60_000;
  const stuck = !!session.heldSince && Date.now() - new Date(session.heldSince).getTime() > STUCK_MS;
  if ((held > 0 && (lastError || stuck)) || dead > 0) {
    const why = lastError
      || (dead > 0 ? `${dead} push${dead === 1 ? "" : "es"} gave up after repeated failures` : "")
      || `${held} conversation(s) held since ${session.heldSince?.slice(0, 10)} with no reason recorded — apply 20261019000000_port_wab_parity.sql`;
    return { configured: true, state: "failing", pending, dead, held, lastOkAt, lastError, detail: `Not reaching LeadSquared — ${why}` };
  }
  if (pending > 0 || held > 0) {
    const n = pending + held;
    return { configured: true, state: "syncing", pending, dead, held, lastOkAt, lastError, detail: `${n} update${n === 1 ? "" : "s"} waiting to sync — retrying automatically.` };
  }
  return { configured: true, state: "ok", pending, dead, held, lastOkAt, lastError, detail: "Every chat has been pushed to LeadSquared." };
}

async function lastSuccessfulPushAt(tenantId: string): Promise<string | null> {
  try {
    const { data } = await db().from("wa_settings").select("value").eq("tenant_id", tenantId).eq("key", "crm_session_flush_health").maybeSingle();
    return ((data?.value ?? {}) as { lastOkAt?: string }).lastOkAt ?? null;
  } catch { return null; }
}

// Pull every held conversation back to "due now" so the next cron tick retries
// the whole backlog at once.
//
// Needed because of how the hold works. A PERMANENT rejection — LeadSquared
// refusing the request itself, e.g. a deactivated activity event code — parks a
// row at the slowest backoff tier, 24 hours out. That is right while the CRM is
// still broken and exactly wrong the moment someone fixes it: the operator has
// just repaired the config and wants their backlog now, not trickling back over
// the next day. Nothing else can shorten that wait.
//
// Sets last_message_at older than the quiet window (that column doubles as the
// backoff deadline) and clears attempts, so a row that fails again gets the
// gentle ramp from the start rather than staying pinned at 24h.
export async function retryHeldCrmSessions(tenantId: string = DEFAULT_TENANT_ID): Promise<{ released: number }> {
  try {
    const dueNow = new Date(Date.now() - SESSION_GAP_MS - 60_000).toISOString();
    // Pending only. A discarded row has no lead left to post to, so releasing it
    // would resurrect a terminal row, spend a LeadSquared call rediscarding it,
    // and do that again on every click.
    const scoped = await db().from("wa_crm_session")
      .update({ attempts: 0, last_message_at: dueNow })
      .eq("tenant_id", tenantId).eq("status", "pending").gt("attempts", 0)   // only rows that have actually failed
      .select("id");
    let data = scoped.data, error = scoped.error;
    if (error && isMissingColumn(error)) {
      ({ data, error } = await db().from("wa_crm_session")   // status column not applied yet
        .update({ attempts: 0, last_message_at: dueNow })
        .eq("tenant_id", tenantId).gt("attempts", 0)
        .select("id"));
    }
    if (error) throw error;
    const released = (data ?? []).length;
    console.warn(JSON.stringify({ tag: "crm_sessions_released", tenant: tenantId, released }));
    return { released };
  } catch (err) {
    console.error("[leadsquared] retryHeldCrmSessions failed:", errorMessage(err));
    return { released: 0 };
  }
}

// ── Per-conversation push status ──────────────────────────────────────────────
// The bar at the top of Live Chat answers "is LeadSquared working?". It cannot
// answer "did THIS chat get through?", which is the question an agent actually
// has while looking at one conversation — an aggregate backlog reads as busy,
// whereas "this customer's last four messages never reached their timeline"
// reads as broken.
//
// One query for the whole inbox rather than one per chat: the buffer is small
// (one row per in-flight conversation, deleted on a successful post) and the
// list needs every row anyway.
export interface CrmChatStatuses {
  configured: boolean;
  /** Keyed by crmChatKey() — see crmkey.ts for why it is the last 10 digits. */
  statuses: Record<string, ChatCrmStatus>;
  /** Why held chats are failing. Recorded per flush, not per row, so it is shared. */
  lastError: string;
}

export async function crmChatStatuses(tenantId: string = DEFAULT_TENANT_ID): Promise<CrmChatStatuses> {
  if (!await lsqConfigured(tenantId)) return { configured: false, statuses: {}, lastError: "" };
  const statuses: Record<string, ChatCrmStatus> = {};

  // `lines` is deliberately not selected: it is jsonb of up to SESSION_NOTE_CAP
  // bytes per row and nothing here reads its contents, only whether the row
  // exists and whether it has failed. Discarded rows (their lead was deleted)
  // are terminal and owe the chat nothing, so they are not "queued".
  type SessionRow = { phone: string; attempts: number; last_message_at: string };
  let sessions: SessionRow[];
  try {
    sessions = await pageAll<SessionRow>(
      () => db().from("wa_crm_session").select("phone, attempts, last_message_at").eq("tenant_id", tenantId).eq("status", "pending").order("phone"),
      { cap: 20_000, label: "crm_chat_statuses" },
    );
  } catch (err) {
    if (!isMissingColumn(err as { code?: string })) throw err;
    sessions = await pageAll<SessionRow>(   // status column not applied yet
      () => db().from("wa_crm_session").select("phone, attempts, last_message_at").eq("tenant_id", tenantId).order("phone"),
      { cap: 20_000, label: "crm_chat_statuses" },
    );
  }
  for (const s of sessions) {
    const key = crmChatKey(s.phone);
    if (!key) continue;
    const attempts = s.attempts ?? 0;
    // last_message_at doubles as the backoff deadline once a row has failed, so
    // "due at" is the same expression either way: the flush picks up rows whose
    // last_message_at is older than the quiet gap.
    const due = new Date(s.last_message_at).getTime() + SESSION_GAP_MS;
    statuses[key] = { state: attempts > 0 ? "held" : "queued", attempts, dueAt: Number.isFinite(due) ? new Date(due).toISOString() : null };
  }

  // Dead queue rows outrank a buffered one: those pushes were abandoned, so the
  // chat is missing data that no amount of waiting will deliver.
  const dead = await pageAll<{ payload: unknown }>(
    () => db().from("wa_crm_sync").select("payload").eq("tenant_id", tenantId).in("kind", ["wa", "chat"]).eq("status", "dead").order("id"),
    { cap: 5_000, label: "crm_chat_statuses_dead" },
  );
  for (const row of dead) {
    const p = (row.payload ?? {}) as { phone?: string; handle?: string };
    const key = crmChatKey(p.phone) || crmChatKey(p.handle ? `handle:${p.handle}` : "");
    if (!key) continue;
    statuses[key] = { state: "dead", attempts: 0, dueAt: null };
  }

  const { lastError } = await crmSessionStats(tenantId);
  return { configured: true, statuses, lastError };
}

// Queue health: how much is waiting / dead (optionally for one tenant).
export async function crmSyncStats(tenantId?: string): Promise<{ pending: number; dead: number; broken?: string }> {
  try {
    const base = () => {
      let q = db().from("wa_crm_sync").select("id", { count: "exact", head: true }).in("kind", ["wa", "chat"]);   // LSQ rows only — the table is shared
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    };
    const [p, d] = await Promise.all([base().eq("status", "pending"), base().eq("status", "dead")]);
    return { pending: p.count ?? 0, dead: d.count ?? 0 };
  } catch (err) { return { pending: 0, dead: 0, broken: errorMessage(err) }; }
}

import type { LsqEvent } from "./lsqwebhook";
export function lsqTimestamp(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  return Date.parse(s.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? "" : "Z")) || 0;
}
export const LEAD_COLUMNS = [
  "ProspectID", "FirstName", "LastName", "Phone", "Mobile", "EmailAddress",
  "ProspectStage", "Source", "Owner", "OwnerIdName", "OwnerIdEmailAddress",
  // mx_City and mx_Course_Interested are what the drip's audience rules are
  // written against: without them a polled lead fails the day 7, 12 and 18
  // gates and gets a two-message "four-week" nurture.
  "mx_City", "mx_Course_Interested", "CreatedOn", "ModifiedOn",
  // Scores. mx_Lead_Score is the one a counsellor sets by hand (Hot / Warm /
  // Cold / Junk); the other three are LeadSquared's own numeric scoring.
  "mx_Lead_Score", "Score", "EngagementScore", "QualityScore01",
];
export interface ChangedLead { ev: LsqEvent; modifiedAt: number }
export async function leadsOnStageSince(
  stage: string,
  sinceMs: number,
  max = 200, tenantId = DEFAULT_TENANT_ID,
): Promise<{ changed: ChangedLead[]; scanned: number; truncated: boolean; error?: string }> {
  const empty = { changed: [] as ChangedLead[], scanned: 0, truncated: false };
  if (!await lsqConfigured(tenantId)) return { ...empty, error: "LeadSquared isn't configured." };
  if (!stage.trim()) return { ...empty, error: "No stage configured to watch." };

  const { accessKey, secretKey, host } = (await resolveLsq(tenantId))!;
  const cols = LEAD_COLUMNS.join(",");
  const changed: ChangedLead[] = [];
  const seen = new Set<string>();
  let scanned = 0, truncated = false;

  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(`${host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Parameter: { LookupName: "ProspectStage", LookupValue: stage.trim() },
          Columns: { Include_CSV: cols },
          Paging: { PageIndex: page, PageSize: 200 },
          Sorting: { ColumnName: "ModifiedOn", Direction: "1" },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { changed, scanned, truncated, error: `LeadSquared search failed (HTTP ${res.status}).` };
      const data = await res.json().catch(() => null);
      const rows = (Array.isArray(data) ? data : (data?.Leads ?? [])) as Record<string, unknown>[];
      if (!rows.length) break;

      let matchedOnPage = 0;
      for (const row of rows) {
        scanned++;
        const lead = flattenLead(row);
        const modifiedAt = lsqTimestamp(lead.ModifiedOn);
        // A lead with no readable ModifiedOn cannot be placed in time. Skipping
        // it is the safe answer: the alternative is treating it as "just now"
        // and re-enrolling it on every single pass, forever.
        if (!modifiedAt || modifiedAt <= sinceMs) continue;
        matchedOnPage++;

        const phone = (lead.Phone || lead.Mobile || "").replace(/\D/g, "");
        if (phone.length < 10) continue;
        const key = phone.slice(-10);
        if (seen.has(key)) continue;
        seen.add(key);

        const name = `${lead.FirstName ?? ""} ${lead.LastName ?? ""}`.trim();
        const ownerEmail = (lead.OwnerIdEmailAddress || "").trim().toLowerCase();
        changed.push({
          modifiedAt,
          ev: {
            // Labelled for what it is. The label only affects logging — every
            // action downstream is driven by the fields — but it is also what
            // keeps a "created"-triggered lead-welcome from firing on a sweep.
            event: "stage_changed",
            phone,
            name: name || null,
            email: (lead.EmailAddress || "").trim() || null,
            ownerEmail: ownerEmail || null,
            ownerName: (lead.OwnerIdName || "").trim() || null,
            stage: (lead.ProspectStage || "").trim() || null,
            leadScore: (lead.mx_Lead_Score || "").trim() || null,
            leadId: (lead.ProspectID || "").trim() || null,
            source: (lead.Source || "").trim() || null,
            course: (lead.mx_Course_Interested || "").trim() || null,
            city: (lead.mx_City || "").trim() || null,
          },
        });
        if (changed.length >= max) { truncated = true; break; }
      }
      // Newest-first means a page with nothing new is past the window, and so
      // is every page after it.
      if (truncated || !matchedOnPage || rows.length < 200) break;
    }
    changed.sort((a, b) => a.modifiedAt - b.modifiedAt);   // oldest first — the watermark advances monotonically
    return { changed, scanned, truncated };
  } catch (err) {
    return { changed, scanned, truncated, error: errorMessage(err) };
  }
}

// Per tenant: lsq_paused is a tenant-scoped setting, and a single cache would let
// one business's pause silence another's CRM sync. Cached because it is read on
// EVERY message push; 30s is short enough that another serverless instance picks
// a change up quickly, and the settings route clears this process's copy at once.
const PAUSE_TTL_MS = 30_000;
const pauseCache = new Map<string, { at: number; v: boolean }>();

export async function lsqPaused(tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const hit = pauseCache.get(tenantId);
  if (hit && Date.now() - hit.at < PAUSE_TTL_MS) return hit.v;
  try {
    const v = (await getTenantSetting(tenantId, "lsq_paused", false)) === true;
    pauseCache.set(tenantId, { at: Date.now(), v });
    return v;
  } catch {
    return hit?.v ?? false;   // a settings blip must not flip the switch either way
  }
}

// Called by the settings route the moment somebody flips the switch, so the
// change is instant in this process instead of up to the TTL later.
export function resetLsqPauseCache(tenantId?: string): void {
  if (tenantId) pauseCache.delete(tenantId); else pauseCache.clear();
}

// Every tenant that has paused its CRM sync. The two drains span ALL tenants, so
// they exclude these in the QUERY: checking per row would let a paused tenant
// with a full batch of due rows crowd everybody else out of every tick.
async function pausedTenantIds(): Promise<string[]> {
  try {
    const { data } = await db().from("wa_settings").select("tenant_id").eq("key", "lsq_paused").eq("value", true);
    return ((data ?? []) as { tenant_id: string }[]).map(r => r.tenant_id).filter(Boolean);
  } catch { return []; }
}
