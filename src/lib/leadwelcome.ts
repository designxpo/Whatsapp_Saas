// Landing-page form → WhatsApp flow bridge. A cold web-form lead (who never
// messaged us) can't be sent free-form messages — Meta only allows a business to
// OPEN the conversation with an approved TEMPLATE. So when a form lead arrives
// from LeadSquared, we send that template NOW and ARM the question flow, so the
// lead's first reply/tap runs the interactive Q&A inside the 24h window. This is
// the one thing stage-drips/sequences can't do (a sequence sends templated
// messages on a schedule; it never arms a flow). Per-tenant config in settings
// (no migration); dormant until enabled + a template and flow are chosen.
import { getTenantSetting, setTenantSetting } from "./store";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface LeadWelcome {
  enabled: boolean;
  templateName: string;    // approved template sent as the first (business-initiated) touch
  languageCode: string;    // e.g. "en" | "en_US" — must match the approved template's language
  nameParam: boolean;      // the template body uses {{1}} = the lead's first name
  flowId: string;          // the question flow armed for the reply
  trigger: string;         // "created" = fire on lead_created; else an LSQ stage name (fires when the lead ENTERS it)
  sourceContains: string;  // optional scope: only leads whose LSQ Source contains this (case-insensitive); "" = any source
}

const KEY = "lead_welcome";
const DEFAULT: LeadWelcome = { enabled: false, templateName: "", languageCode: "en", nameParam: false, flowId: "", trigger: "created", sourceContains: "" };
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

// LeadSquared stores Indian numbers 10-digit (no country code), but WhatsApp
// needs the full international number to DELIVER a template — so a raw LSQ phone
// would silently fail to send. Prepend the default country code (91) to a bare
// national number; leave already-coded numbers untouched. A foreign number that
// already carries its own code passes through.
export function toWaNumber(phone: string, defaultCc = "91"): string {
  let d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);   // strip a trunk 0
  if (d.length === 10) d = defaultCc + d;                      // bare national → add the country code
  return d;
}

export async function getLeadWelcome(tenantId: string = DEFAULT_TENANT_ID): Promise<LeadWelcome> {
  const raw = await getTenantSetting<Partial<LeadWelcome>>(tenantId, KEY, {});
  return { ...DEFAULT, ...(raw && typeof raw === "object" ? raw : {}) };
}

export async function setLeadWelcome(p: Partial<LeadWelcome>, tenantId: string = DEFAULT_TENANT_ID): Promise<LeadWelcome> {
  const next = { ...(await getLeadWelcome(tenantId)), ...p };
  const clean: LeadWelcome = {
    enabled: !!next.enabled,
    templateName: (next.templateName ?? "").trim(),
    languageCode: (next.languageCode ?? "en").trim() || "en",
    nameParam: !!next.nameParam,
    flowId: (next.flowId ?? "").trim(),
    trigger: (next.trigger ?? "created").trim() || "created",
    sourceContains: (next.sourceContains ?? "").trim(),
  };
  await setTenantSetting(tenantId, KEY, clean);
  return clean;
}

// Pure decision — should this LSQ event fire the welcome (template + arm flow)?
// No IO, so the webhook stays testable. Gated on: the automation being fully
// configured, the lead being fresh (not already welcomed) and not opted out, an
// optional Source scope, and the trigger (lead_created OR entering a stage).
export function shouldWelcome(
  cfg: LeadWelcome,
  ev: { event: string; stage: string | null; source: string | null },
  prevStage: string | undefined,
  opts: { alreadyWelcomed: boolean; optedOut: boolean },
): boolean {
  if (!cfg.enabled || !cfg.templateName || !cfg.flowId) return false;
  if (opts.alreadyWelcomed || opts.optedOut) return false;
  if (cfg.sourceContains && !norm(ev.source).includes(norm(cfg.sourceContains))) return false;
  if (norm(cfg.trigger) === "created") return ev.event === "lead_created";
  // Stage trigger: fire only when the lead ENTERS the configured stage (a real
  // transition), so a replayed webhook carrying the same stage can't re-fire.
  return !!ev.stage && norm(ev.stage) === norm(cfg.trigger) && norm(ev.stage) !== norm(prevStage);
}
