// Canned templates — one-click, pre-approved WhatsApp templates a team member
// fires from the chat (e.g. RNR, post-call follow-up). Each maps an approved
// template + body-variable presets + an optional LeadSquared lead-stage change.
// Config lives in wa_settings (tenant-scoped, no migration); it's a small
// admin-managed list per workspace.

import { getTenantSetting, setTenantSetting } from "./store";

export interface Canned {
  id: string;                 // stable slug
  label: string;              // button text, e.g. "RNR" / "Post-call follow-up"
  templateName: string;       // approved template name on the sending number's WABA
  language: string;           // e.g. "en_US"
  params: string[];           // body {{1}},{{2}}… — tokens {agent} {name} {<attr>} or literal text ({counselor} also works, kept for templates saved before the rename)
  headerImageUrl?: string;    // optional header image (not WABA-scoped)
  stage?: string;             // optional LSQ lead stage to set on send (e.g. "RNR")
}

const KEY = "canned_templates";

export async function getCannedTemplates(tenantId: string): Promise<Canned[]> {
  const raw = await getTenantSetting<Canned[]>(tenantId, KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(c => c && typeof c.id === "string" && c.id && typeof c.templateName === "string" && c.templateName)
    .map(c => ({
      id: c.id, label: (c.label || c.templateName).trim(), templateName: c.templateName.trim(),
      language: (c.language || "en_US").trim(), params: Array.isArray(c.params) ? c.params.map(String) : [],
      headerImageUrl: c.headerImageUrl?.trim() || undefined, stage: c.stage?.trim() || undefined,
    }));
}

export async function setCannedTemplates(tenantId: string, list: Canned[]): Promise<void> {
  const seen = new Set<string>();
  const clean = (list ?? [])
    .filter(c => c && c.id?.trim() && c.templateName?.trim())
    .map(c => ({
      id: c.id.trim(), label: (c.label || c.templateName).trim(), templateName: c.templateName.trim(),
      language: (c.language || "en_US").trim(), params: (c.params ?? []).map(p => String(p ?? "")),
      headerImageUrl: c.headerImageUrl?.trim() || undefined, stage: c.stage?.trim() || undefined,
    }))
    .filter(c => { const k = c.id.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  await setTenantSetting(tenantId, KEY, clean);
}

// Fill {token} placeholders in each body param. Tokens are case-insensitive:
// {agent} = the logged-in team member's name (alias: {counselor}), {name} = the
// contact's name, and {<anything>} = that contact attribute (e.g. {city});
// unknown → "".
// Resolved values are sanitized for Meta, which rejects template params with
// newlines/tabs or runs of spaces (contact attributes are raw typed answers).
export function resolveCannedParams(params: string[], tokens: Record<string, string>): string[] {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) lower[k.toLowerCase()] = v ?? "";
  const lookup = (k: string) => (Object.prototype.hasOwnProperty.call(lower, k) ? lower[k] : "");  // never Object.prototype members
  return params.map(p =>
    p.replace(/\{(\w+)\}/g, (_m, k) => lookup(String(k).toLowerCase()))
      .replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim(),
  );
}
