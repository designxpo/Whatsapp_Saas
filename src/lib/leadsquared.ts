// LeadSquared CRM sync — posts WhatsApp messages onto the lead's activity
// timeline so the sales team sees the full conversation inside the CRM.
//
// Required env (all optional — sync is silently skipped when unset):
//   LSQ_ACCESS_KEY / LSQ_SECRET_KEY  — LeadSquared API credentials (My Profile → Settings → API and Webhooks)
//   LSQ_API_HOST                     — region host, e.g. https://api-in21.leadsquared.com
//   LSQ_ACTIVITY_CODE                — event code of a Custom Activity named e.g. "WhatsApp Message"

import { errorMessage } from "./errors";

function cfg() {
  const accessKey = process.env.LSQ_ACCESS_KEY ?? "";
  const secretKey = process.env.LSQ_SECRET_KEY ?? "";
  const host = (process.env.LSQ_API_HOST ?? "").replace(/\/+$/, "");
  const activityCode = parseInt(process.env.LSQ_ACTIVITY_CODE ?? "", 10);
  return { accessKey, secretKey, host, activityCode };
}

export function lsqConfigured(): boolean {
  const { accessKey, secretKey, host, activityCode } = cfg();
  return Boolean(accessKey && secretKey && host && Number.isFinite(activityCode));
}

// New inbound contacts become LSQ leads automatically only when this is on —
// off by default so we never spam the CRM (or its lead-creation automations).
function autoCreateLeads(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.LSQ_AUTOCREATE_LEADS ?? "");
}

// Creates (or updates, via LSQ's dedup) a lead from a phone + optional name.
// Returns the ProspectID, or null on failure / when LSQ is unconfigured.
export async function createOrUpdateLead(p: { phone: string; name?: string; source?: string; fields?: { Attribute: string; Value: string }[] }): Promise<string | null> {
  if (!lsqConfigured()) return null;
  try {
    const { accessKey, secretKey, host } = cfg();
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
    const res = await fetch(`${host}/v2/LeadManagement.svc/Lead.Capture?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
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

// Returns the lead's ProspectID by phone, creating it first only if auto-create
// is enabled. Used by the panel's "add to CRM" action.
export async function ensureLead(phone: string, name?: string, source?: string): Promise<string | null> {
  const existing = await findLeadId(phone);
  if (existing) return existing;
  return createOrUpdateLead({ phone, name, source });
}

// Public phone→ProspectID lookup (for panel actions that must NOT create).
export async function getLeadIdByPhone(phone: string): Promise<string | null> {
  return findLeadId(phone);
}

// Moves a lead to a new ProspectStage. Returns true on success.
export async function updateLeadStage(leadId: string, stage: string): Promise<boolean> {
  if (!lsqConfigured() || !leadId || !stage) return false;
  try {
    const { accessKey, secretKey, host } = cfg();
    const res = await fetch(`${host}/v2/LeadManagement.svc/Lead.Update?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}&leadId=${encodeURIComponent(leadId)}`, {
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
export async function createLeadTask(leadId: string, p: { name: string; notes?: string; dueDate?: string }): Promise<boolean> {
  if (!lsqConfigured() || !leadId || !p.name?.trim()) return false;
  try {
    const { accessKey, secretKey, host } = cfg();
    const category = process.env.LSQ_TASK_CATEGORY || "2";
    const due = p.dueDate || new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const res = await fetch(`${host}/v2/Task.svc/Create?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Task: { Category: category, Name: p.name.trim(), StatusCode: 0, DueDate: due, RelatedEntityId: leadId, Notes: p.notes ?? "" } }),
    });
    return res.ok;
  } catch (err) {
    console.error("[leadsquared] task create failed:", errorMessage(err));
    return false;
  }
}

// Looks up the LeadSquared ProspectID for a phone number. Tries +<digits>
// first (LSQ usually stores E.164), then bare digits.
async function findLeadId(phone: string): Promise<string | null> {
  const { accessKey, secretKey, host } = cfg();
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  for (const candidate of [`+${digits}`, digits]) {
    const url = `${host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}&phone=${encodeURIComponent(candidate)}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const leads = (await res.json().catch(() => [])) as { ProspectID?: string }[];
    if (Array.isArray(leads) && leads[0]?.ProspectID) return leads[0].ProspectID;
  }
  return null;
}

// Looks up the LeadSquared ProspectID by Instagram handle. Requires the org to
// store the handle in a lead field whose schema name is set in LSQ_IG_HANDLE_FIELD
// (e.g. mx_Instagram). Tries the bare handle and the @-prefixed form. Returns null
// when the field isn't configured or no lead matches.
async function findLeadIdByHandle(handle: string): Promise<string | null> {
  const { accessKey, secretKey, host } = cfg();
  const field = (process.env.LSQ_IG_HANDLE_FIELD ?? "").trim();
  const h = (handle || "").replace(/^@/, "").trim();
  if (!field || !h) return null;
  for (const value of [h, `@${h}`]) {
    try {
      const url = `${host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`;
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

// Pulls a real phone number out of a contact's collected attributes (e.g. one an
// Instagram lead shared in chat or a flow captured), so an IG conversation can be
// matched to an LSQ lead by phone. Returns null when no phone-like attribute exists.
export function phoneFromAttributes(attributes: Record<string, string> | null | undefined): string | null {
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (/phone|mobile|whats?app|contact|number/i.test(k) && String(v).replace(/\D/g, "").length >= 10) return String(v);
  }
  return null;
}

// The CRM picture of a lead, surfaced inside Live Chat / the profile drawer so
// sales sees stage/owner/score without opening LeadSquared.
export interface CrmLead {
  id: string;
  stage: string | null;
  owner: string | null;
  score: number | null;
  source: string | null;
  fields: { label: string; value: string }[];   // a few extra useful fields when present
}

// ── Bulk extract (for LeadSquared-sourced drips) ─────────────────────────────
export type LeadCond = { field: string; op: "eq" | "contains" | "gt" | "lt"; value: string };
export interface ExtractedLead { phone: string; name: string }

// Flattens an LSQ lead record (flat dict OR { LeadPropertyList:[{Attribute,Value}] }).
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
// server-side LSQ query (Leads.Get, paged); the rest filter locally — so any
// combination of fields/operators works without depending on LSQ's fragile
// advanced-search payload. Requires ≥1 "eq" condition as the anchor.
export async function fetchLeads(conditions: LeadCond[], max = 2000): Promise<{ leads: ExtractedLead[]; scanned: number; truncated: boolean; error?: string }> {
  if (!lsqConfigured()) return { leads: [], scanned: 0, truncated: false, error: "LeadSquared isn't configured." };
  const anchor = conditions.find(c => c.op === "eq" && c.field.trim() && c.value.trim());
  if (!anchor) return { leads: [], scanned: 0, truncated: false, error: "Add at least one exact-match (equals) condition to anchor the search." };
  const { accessKey, secretKey, host } = cfg();
  const cols = "ProspectID,FirstName,LastName,Phone,Mobile,EmailAddress,ProspectStage,Source,Owner,OwnerIdName,mx_City,CreatedOn";
  const seen = new Set<string>();
  const leads: ExtractedLead[] = [];
  let scanned = 0, truncated = false;
  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${host}/v2/LeadManagement.svc/Leads.Get?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
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
        if (!conditions.every(c => matchesCond(lead, c))) continue;
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

// Reads the lead's core CRM fields by phone. Returns null when LSQ isn't
// configured or the number isn't in the CRM. Never throws.
export async function fetchLeadDetails(phone: string): Promise<CrmLead | null> {
  if (!lsqConfigured()) return null;
  try {
    const { accessKey, secretKey, host } = cfg();
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return null;
    for (const candidate of [`+${digits}`, digits]) {
      const url = `${host}/v2/LeadManagement.svc/RetrieveLeadByPhoneNumber?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}&phone=${encodeURIComponent(candidate)}`;
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
}): Promise<void> {
  if (!lsqConfigured()) return;
  try {
    const { accessKey, secretKey, host, activityCode } = cfg();
    let leadId = await findLeadId(p.phone);
    // New inbound contact + auto-create on → create the lead, then attach.
    if (!leadId && p.direction === "inbound" && autoCreateLeads()) leadId = await createOrUpdateLead({ phone: p.phone, source: "WhatsApp" });
    if (!leadId) return; // phone not in CRM — nothing to attach to

    const arrow = p.direction === "inbound" ? "⬅️ Lead" : "➡️ " + (p.via === "bot" ? "AI Assistant" : p.via === "crm" ? "Sales (CRM)" : "Agent");
    const note = `${arrow}: ${p.body}`.slice(0, 1800);

    await fetch(`${host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: activityCode, ActivityNote: note }),
    });
  } catch (err) {
    console.error("[leadsquared] activity push failed:", errorMessage(err));
  }
}

// Instagram version of pushWaActivity. IG users have no phone, so the lead is
// resolved by a known phone first (one shared in chat / captured by a flow), then
// by Instagram handle (needs LSQ_IG_HANDLE_FIELD). Marks the note as Instagram so
// the timeline distinguishes channels. Never throws.
export async function pushIgActivity(p: {
  igUserId: string;
  handle?: string | null;
  phone?: string | null;
  direction: "inbound" | "outbound";
  body: string;
  via?: "lead" | "bot" | "agent";
}): Promise<void> {
  if (!lsqConfigured()) return;
  try {
    let leadId: string | null = null;
    if (p.phone) leadId = await findLeadId(p.phone);
    if (!leadId && p.handle) leadId = await findLeadIdByHandle(p.handle);
    // New inbound IG lead who shared a phone + auto-create on → create, then attach.
    if (!leadId && p.phone && p.direction === "inbound" && autoCreateLeads()) leadId = await createOrUpdateLead({ phone: p.phone, name: p.handle ?? undefined, source: "Instagram" });
    if (!leadId) return; // can't match this IG user to a CRM lead — skip

    const arrow = p.direction === "inbound"
      ? "⬅️ Lead (Instagram)"
      : "➡️ " + (p.via === "bot" ? "AI Assistant" : "Agent") + " (Instagram)";
    const note = `${arrow}: ${p.body}`.slice(0, 1800);

    const { accessKey, secretKey, host, activityCode } = cfg();
    await fetch(`${host}/v2/ProspectActivity.svc/Create?accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RelatedProspectId: leadId, ActivityEvent: activityCode, ActivityNote: note }),
    });
  } catch (err) {
    console.error("[leadsquared] IG activity push failed:", errorMessage(err));
  }
}
