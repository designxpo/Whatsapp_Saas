// Entitlement registry — the PURE, client-safe single source of truth for what
// features exist, which admin tab each one gates, and how to display them. No
// server imports here, so both the React UI and server guards can import it and
// can never drift apart. The per-plan defaults live in the DB (wa_plans.features);
// the resolver in entitlements.ts merges those with per-tenant overrides.

export type FeatureKey =
  | "ch_whatsapp" | "ch_instagram" | "ch_messenger" | "ch_webchat"
  | "ai_autoreply" | "broadcasts" | "flows" | "sequences" | "commerce"
  | "forms" | "pipeline" | "growth" | "ads" | "aihub" | "crm";

export const FEATURE_KEYS: FeatureKey[] = [
  "ch_whatsapp", "ch_instagram", "ch_messenger", "ch_webchat",
  "ai_autoreply", "broadcasts", "flows", "sequences", "commerce",
  "forms", "pipeline", "growth", "ads", "aihub", "crm",
];

export const FEATURE_META: Record<FeatureKey, { label: string; group: string }> = {
  ch_whatsapp:  { label: "WhatsApp channel", group: "Channels" },
  ch_instagram: { label: "Instagram channel", group: "Channels" },
  ch_messenger: { label: "Facebook Messenger channel", group: "Channels" },
  ch_webchat:   { label: "Website web chat", group: "Channels" },
  ai_autoreply: { label: "AI auto-replies", group: "AI" },
  broadcasts:   { label: "Broadcasts & templates", group: "Messaging" },
  flows:        { label: "Chatbot flows", group: "Automation" },
  sequences:    { label: "Drip sequences", group: "Automation" },
  commerce:     { label: "Catalog & checkout", group: "Commerce" },
  forms:        { label: "WhatsApp Forms", group: "Automation" },
  pipeline:     { label: "Sales pipeline", group: "Sales" },
  growth:       { label: "Growth tools", group: "Growth" },
  ads:          { label: "Meta Ads", group: "Growth" },
  aihub:        { label: "AI Hub", group: "AI" },
  crm:          { label: "CRM sync", group: "Integrations" },
};

// Admin tab key → the feature it requires (null = always available / core).
// Broadcasts & Templates require the WhatsApp-broadcasts capability; the three
// non-WhatsApp channels gate on their own channel key. Keyed by string to avoid
// importing the admin Tab type (keeps this module dependency-free).
export const TAB_FEATURE: Record<string, FeatureKey | null> = {
  home: null, livechat: null, contacts: null, campaigns: null, analytics: null,
  assistant: null, setup: null, integrations: null, optouts: null, settings: null,
  broadcast: "broadcasts", templates: "broadcasts",
  instagram: "ch_instagram", facebook: "ch_messenger", webchat: "ch_webchat",
  flows: "flows", sequences: "sequences", catalog: "commerce", forms: "forms",
  pipeline: "pipeline", growth: "growth", ads: "ads", aihub: "aihub",
};

export interface EntitlementLimits {
  contacts: number; conversations_per_month: number; messages_per_month: number; channels: number; team_seats: number;
}
export interface EntitlementUsage { contacts: number; conversations: number; messages: number; channels: number; seats: number }

export interface Entitlements {
  features: Record<FeatureKey, boolean>;
  limits: EntitlementLimits;
  usage?: EntitlementUsage;
  plan: string;
  status: string;          // tenant status: active | trialing | suspended | cancelled
  paymentStatus: string;   // trialing | active | past_due | cancelled | none
  trialEndsAt: string | null;
  enforcing: boolean;      // master kill-switch (enforce_entitlements flag)
  grandfathered: boolean;  // existing tenant kept on full access
}

// Convenience: does this tab pass given a resolved entitlements object?
export function tabAllowed(tab: string, ent: Entitlements | null | undefined): boolean {
  if (!ent) return true;                 // not loaded yet → don't flicker-hide
  if (!ent.enforcing) return true;       // kill-switch off → show everything
  const feat = TAB_FEATURE[tab];
  if (!feat) return true;                // core tab
  return ent.features[feat] === true;
}

// ── Account / billing state ───────────────────────────────────────────────────
// Derives whether the workspace is in good standing. Read-only soft block: when
// not active, mutating actions are paused (data is never deleted) and a banner
// prompts the user to fix billing. Respects the kill-switch like everything else.
export type AccountState = "ok" | "trial_expired" | "past_due" | "suspended";
export function accountState(ent: Entitlements | null | undefined): { state: AccountState; active: boolean; message: string } {
  if (!ent || !ent.enforcing) return { state: "ok", active: true, message: "" };
  if (ent.status === "suspended" || ent.status === "cancelled")
    return { state: "suspended", active: false, message: "Your workspace is paused. Reactivate your subscription to send and automate again." };
  if (ent.paymentStatus === "past_due")
    return { state: "past_due", active: false, message: "Your last payment failed — update your billing to keep automations running." };
  const onTrial = ent.paymentStatus === "trialing" || ent.status === "trialing";
  if (onTrial && ent.trialEndsAt && Date.parse(ent.trialEndsAt) < Date.now())
    return { state: "trial_expired", active: false, message: "Your free trial has ended. Choose a plan to keep using Talko AI." };
  return { state: "ok", active: true, message: "" };
}
