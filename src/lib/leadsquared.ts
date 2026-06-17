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
    const leadId = await findLeadId(p.phone);
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
