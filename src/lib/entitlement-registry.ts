// Entitlement registry — the PURE, client-safe single source of truth for what
// features exist, which admin tab each one gates, and how to display them. No
// server imports here, so both the React UI and server guards can import it and
// can never drift apart. The per-plan defaults live in the DB (wa_plans.features);
// the resolver in entitlements.ts merges those with per-tenant overrides.

export type FeatureKey =
  | "ch_whatsapp" | "ch_instagram" | "ch_messenger" | "ch_webchat" | "ch_youtube"
  | "reviews"
  | "ai_autoreply" | "broadcasts" | "flows" | "sequences" | "commerce"
  | "forms" | "pipeline" | "growth" | "ads" | "aihub" | "crm" | "extension";

export const FEATURE_KEYS: FeatureKey[] = [
  "ch_whatsapp", "ch_instagram", "ch_messenger", "ch_webchat", "ch_youtube",
  "reviews",
  "ai_autoreply", "broadcasts", "flows", "sequences", "commerce",
  "forms", "pipeline", "growth", "ads", "aihub", "crm", "extension",
];

export const FEATURE_META: Record<FeatureKey, { label: string; group: string }> = {
  ch_whatsapp:  { label: "WhatsApp channel", group: "Channels" },
  ch_instagram: { label: "Instagram channel", group: "Channels" },
  ch_messenger: { label: "Facebook Messenger channel", group: "Channels" },
  ch_webchat:   { label: "Website web chat", group: "Channels" },
  ch_youtube:   { label: "YouTube comment automation", group: "Channels" },
  reviews:      { label: "Google review replies", group: "Reputation" },
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
  extension:    { label: "Browser extension (Talko Copilot)", group: "Integrations" },
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
  youtube: "ch_youtube", reviews: "reviews",
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

// Admin tab key → the minimum ROLE that can use it (absent = any signed-in
// member). Derived from the API guards behind each tab, not from intuition: a
// tab is admin-only ONLY when its primary GET is requireRoleAdmin, so a member
// would stare at a permanently empty screen whose every button 403s. Tabs that
// merely restrict *some* writes stay open — Settings and Meta Ads already hide
// their admin-only cards internally, and members legitimately broadcast, edit
// templates, build flows and answer chats.
export const TAB_MIN_ROLE: Record<string, "admin"> = {
  sequences: "admin",      // GET /api/admin/sequences
  catalog: "admin",        // GET /api/admin/products + /api/admin/orders
  growth: "admin",         // GET /api/admin/growth
  integrations: "admin",   // GET /api/admin/integrations
  youtube: "admin",        // GET /api/admin/yt-channels
};

// Convenience: may this role open the tab? An unknown role (still loading) is
// allowed so the nav never flickers items away mid-load — same rule tabAllowed
// uses for a not-yet-resolved entitlements object. The platform owner's session
// carries role "admin" (auth.ts), so the owner is never gated here.
export function tabRoleAllowed(tab: string, role: string | null | undefined): boolean {
  if (!role) return true;
  return TAB_MIN_ROLE[tab] !== "admin" || role === "admin";
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
