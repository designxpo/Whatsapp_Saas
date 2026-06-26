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
import { getTenantSetting, getTenantSecret } from "./store";
import { listIntegrations, getIntegrationSecret, setIntegrationError, type Integration } from "./integrations";


export interface LsqCreds {
  accessKey: string; secretKey: string; host: string; activityCode: number;
  taskCategory: string; igHandleField: string; autoCreate: boolean;
}

// Per-tenant setting keys (wa_settings). Access/secret keys live in tenant
// SECRETS (encrypted); the rest are plain settings.
export const LSQ_KEYS = {
  accessKey: "lsq_access_key", secretKey: "lsq_secret_key", host: "lsq_api_host",
  activityCode: "lsq_activity_code", taskCategory: "lsq_task_category",
  igHandleField: "lsq_ig_handle_field", autoCreate: "lsq_autocreate",
} as const;

const boolish = (v: string | null | undefined) => /^(1|true|yes|on)$/i.test(v ?? "");

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

// Creates (or updates, via LSQ's dedup) a lead from a phone + optional name.
// Returns the ProspectID, or null on failure / when the tenant has no CRM.
export async function createOrUpdateLead(p: { phone: string; name?: string; source?: string; fields?: { Attribute: string; Value: string }[] }, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  if (!c) return null;
  try {
    const digits = (p.phone || "").replace(/\D/g, "");
    if (!digits) return null;
    const parts = (p.name || "").trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "", last = parts.slice(1).join(" ");
    const attrs = [
      { Attribute: "Phone", Value: `+${digits}` },
      { Attribute: "Mobile", Value: `+${digits}` },
      ...(first ? [{ Attribute: "FirstName", Value: first }] : []),
      ...(last ? [{ Attribute: "LastName", Value: last }] : []),
      { Attribute: "Source", Value: p.source || "WhatsApp" },
      ...(p.fields ?? []),
    ];
    const res = await fetch(`${c.host}/v2/LeadManagement.svc/Lead.Capture?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attrs),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { Status?: string; Message?: { Id?: string } } | null;
    return data?.Message?.Id ?? null;
  } catch (err) {
    console.error("[leadsquared] lead create failed:", errorMessage(err));
    return null;
  }
}

// Returns the lead's ProspectID by phone, creating it only if auto-create is on.
export async function ensureLead(phone: string, name?: string, source?: string, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  if (!c) return null;
  const existing = await findLeadId(phone, c);
  if (existing) return existing;
  return createOrUpdateLead({ phone, name, source }, tenantId);
}

// Public phone→ProspectID lookup (for panel actions that must NOT create).
export async function getLeadIdByPhone(phone: string, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  const c = await resolveLsq(tenantId);
  return c ? findLeadId(phone, c) : null;
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

// Looks up the LeadSquared ProspectID for a phone number. Tries +<digits> first
// (LSQ usually stores E.164), then bare digits.
async function findLeadId(phone: string, c: LsqCreds): Promise<string | null> {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  // Try E.164 (+<cc><num>) and bare digits, plus the last-10 form so a lead stored
  // WITHOUT a country code (common for Indian numbers) still matches the WhatsApp
  // sender id (e.g. 91XXXXXXXXXX vs a lead saved as XXXXXXXXXX).
  const last10 = digits.length > 10 ? digits.slice(-10) : "";
  for (const candidate of [`+${digits}`, digits, ...(last10 ? [`+${last10}`, last10] : [])]) {
    const url = `${c.host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}&phone=${encodeURIComponent(candidate)}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const leads = (await res.json().catch(() => [])) as { ProspectID?: string }[];
    if (Array.isArray(leads) && leads[0]?.ProspectID) return leads[0].ProspectID;
  }
  return null;
}

// Looks up the LeadSquared ProspectID by Instagram handle. Requires the tenant to
// store the handle in a lead field whose schema name is their lsq_ig_handle_field
// (e.g. mx_Instagram). Tries the bare handle and the @-prefixed form.
async function findLeadIdByHandle(handle: string, c: LsqCreds): Promise<string | null> {
  const field = c.igHandleField;
  const h = (handle || "").replace(/^@/, "").trim();
  if (!field || !h) return null;
  for (const value of [h, `@${h}`]) {
    try {
      const url = `${c.host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Parameter: { LookupName: field, LookupValue: value }, Paging: { PageIndex: 1, PageSize: 1 } }),
      });
      if (!res.ok) continue;
      const data = (await res.json().catch(() => null)) as { ProspectID?: string }[] | null;
      if (Array.isArray(data) && data[0]?.ProspectID) return data[0].ProspectID;
    } catch { /* try next candidate */ }
  }
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

// Fire-and-forget: records one WhatsApp message on the lead's timeline.
// Never throws — CRM sync must not break message delivery.
export async function pushWaActivity(p: {
  phone: string;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent" | "crm";
  tenantId?: string;
}): Promise<void> {
  const c = await resolveLsq(p.tenantId ?? DEFAULT_TENANT_ID);
  if (!c) return;
  try {
    let leadId = await findLeadId(p.phone, c);
    if (!leadId && p.direction === "inbound" && c.autoCreate) leadId = await createOrUpdateLead({ phone: p.phone, source: "WhatsApp" }, p.tenantId ?? DEFAULT_TENANT_ID);
    if (!leadId) return;

    const arrow = p.direction === "inbound" ? "⬅️ Lead" : "➡️ " + (p.via === "bot" ? "AI Assistant" : p.via === "crm" ? "Sales (CRM)" : "Agent");
    const note = `${arrow}: ${p.body}`.slice(0, 1800);

    const res = await fetch(`${c.host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: c.activityCode, ActivityNote: note }),
    });
    // Don't let a rejected push vanish — a wrong activity code / expired key / bad
    // region host would otherwise fail silently and look like "nothing synced".
    // Record it so the tenant SEES it in Settings (parity with the hub's status).
    if (!res.ok) {
      const detail = `HTTP ${res.status} (activity event ${c.activityCode}): ${(await res.text().catch(() => "")).slice(0, 200)}`;
      console.error(`[leadsquared] activity push ${detail} (lead ${leadId})`);
      await noteLsqFailure(p.tenantId ?? DEFAULT_TENANT_ID, detail);
    }
  } catch (err) {
    console.error("[leadsquared] activity push failed:", errorMessage(err));
    await noteLsqFailure(p.tenantId ?? DEFAULT_TENANT_ID, errorMessage(err));
  }
}

// Generic CRM timeline push for the no-native-phone channels (Instagram /
// Messenger / Web chat). The lead is resolved by a known phone first (shared in
// chat / captured by a flow), then by handle (Instagram, needs the tenant's
// lsq_ig_handle_field). The note is labelled with the channel. Never throws, and
// records the failure on the integration so it's visible in Settings.
export async function pushChatActivity(p: {
  phone?: string | null;
  handle?: string | null;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent";
  channel: string;                 // "Instagram" | "Messenger" | "Web chat"
  tenantId?: string;
}): Promise<void> {
  const tid = p.tenantId ?? DEFAULT_TENANT_ID;
  const c = await resolveLsq(tid);
  if (!c) return;
  try {
    let leadId: string | null = null;
    if (p.phone) leadId = await findLeadId(p.phone, c);
    if (!leadId && p.handle) leadId = await findLeadIdByHandle(p.handle, c);
    if (!leadId && p.phone && p.direction === "inbound" && c.autoCreate) leadId = await createOrUpdateLead({ phone: p.phone, name: p.handle ?? undefined, source: p.channel }, tid);
    if (!leadId) return;

    const who = p.via === "bot" ? "AI Assistant" : p.via === "agent" ? "Agent" : "Sales";
    const arrow = p.direction === "inbound" ? `⬅️ Lead (${p.channel})` : `➡️ ${who} (${p.channel})`;
    const note = `${arrow}: ${p.body}`.slice(0, 1800);

    const res = await fetch(`${c.host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(c.accessKey)}&secretKey=${encodeURIComponent(c.secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: c.activityCode, ActivityNote: note }),
    });
    if (!res.ok) {
      const detail = `HTTP ${res.status} (activity event ${c.activityCode}): ${(await res.text().catch(() => "")).slice(0, 200)}`;
      console.error(`[leadsquared] ${p.channel} activity push ${detail} (lead ${leadId})`);
      await noteLsqFailure(tid, detail);
    }
  } catch (err) {
    console.error(`[leadsquared] ${p.channel} activity push failed:`, errorMessage(err));
    await noteLsqFailure(tid, errorMessage(err));
  }
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
