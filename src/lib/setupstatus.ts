// Per-tenant setup/health status. Powers the in-portal Setup wizard: each
// integration is checked LIVE (Meta Graph for WhatsApp/Instagram, the AI
// provider for the key) and reported in plain English so a tenant can self-
// serve onboarding and immediately see — and fix — what's wrong. Tenant-scoped
// throughout; one tenant's broken config never touches another's.

import { listChannels, type Channel } from "./channels";
import { getTenantAiStatus, resolveTenantAi, AiKeyMissingError } from "./ai/keys";
import { validateKey } from "./ai/chat";
import { listDocuments } from "./store";
import { resolveLsq } from "./leadsquared";
import { integrationsHealth, listIntegrations } from "./integrations";
import { getEntitlements } from "./entitlements";
import { getPlan } from "./plans";
import type { FeatureKey } from "./entitlement-registry";
import { errorMessage } from "./errors";

const GRAPH = "https://graph.facebook.com/v22.0";

export type StepStatus = "ok" | "warn" | "todo" | "error";
export interface SetupStep {
  key: "whatsapp" | "instagram" | "messenger" | "webchat" | "ai" | "kb" | "crm";
  title: string;
  status: StepStatus;
  detail: string;        // plain-English current state
  hint?: string;         // plain-English next step (only when not ok)
  fixTab?: string;       // portal tab where the tenant fixes it
  optional?: boolean;
}

// The checklist + a summary of what the tenant's PLAN includes, so the wizard
// only asks for the channels/tools their subscription actually grants.
export interface SetupPlanSummary {
  key: string;
  name: string;
  includedChannels: { key: string; label: string }[];
}
export interface SetupChecklist { steps: SetupStep[]; plan: SetupPlanSummary }

// Turn a Meta Graph error into a non-technical, actionable sentence.
function metaErrorToEnglish(err: { code?: number; message?: string } | null, kind: "whatsapp" | "instagram"): string {
  const code = err?.code;
  const m = (err?.message ?? "").toLowerCase();
  if (code === 190 || m.includes("access token") || m.includes("expired") || m.includes("session has been invalidated"))
    return "The access token is invalid or expired — paste a fresh token from Meta and save again.";
  if (code === 100 || m.includes("unknown path") || m.includes("does not exist") || m.includes("nonexisting field"))
    return kind === "whatsapp"
      ? "We couldn't find that WhatsApp Phone Number ID — double-check it in Meta WhatsApp Manager."
      : "We couldn't find that Instagram account ID — double-check the Instagram professional account ID.";
  if (code === 10 || code === 200 || m.includes("permission"))
    return "The token is missing a required permission — reconnect and grant messaging access.";
  return err?.message ? `Meta couldn't verify this: ${err.message}` : "Meta couldn't verify this connection.";
}

async function verifyWhatsApp(ch: Channel): Promise<{ ok: boolean; detail: string }> {
  if (!ch.token || !ch.phoneId) return { ok: false, detail: "Missing the access token or Phone Number ID — re-enter them in Settings." };
  try {
    const res = await fetch(`${GRAPH}/${ch.phoneId}?fields=verified_name,display_phone_number,quality_rating`, {
      headers: { Authorization: `Bearer ${ch.token}` }, signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data?.id) {
      const name = (data.verified_name as string) || ch.name;
      const num = data.display_phone_number ? ` (${data.display_phone_number})` : "";
      return { ok: true, detail: `Connected — ${name}${num}.` };
    }
    return { ok: false, detail: metaErrorToEnglish((data?.error as { code?: number; message?: string }) ?? null, "whatsapp") };
  } catch {
    return { ok: false, detail: "Couldn't reach Meta to verify right now — try again in a moment." };
  }
}

async function verifyInstagram(ch: Channel): Promise<{ ok: boolean; detail: string }> {
  if (!ch.token || !ch.igUserId) return { ok: false, detail: "Missing the access token or Instagram account ID — re-enter them in Settings." };
  try {
    const res = await fetch(`${GRAPH}/${ch.igUserId}?fields=username,name`, {
      headers: { Authorization: `Bearer ${ch.token}` }, signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data?.id) {
      const handle = data.username ? `@${data.username}` : ((data.name as string) || ch.name);
      return { ok: true, detail: `Connected — ${handle}.` };
    }
    return { ok: false, detail: metaErrorToEnglish((data?.error as { code?: number; message?: string }) ?? null, "instagram") };
  } catch {
    return { ok: false, detail: "Couldn't reach Meta to verify right now — try again in a moment." };
  }
}

async function verifyMessenger(ch: Channel): Promise<{ ok: boolean; detail: string }> {
  if (!ch.token || !ch.pageId) return { ok: false, detail: "Missing the Page access token or Page ID — re-enter them in the Messenger tab." };
  try {
    const res = await fetch(`${GRAPH}/${ch.pageId}?fields=name`, {
      headers: { Authorization: `Bearer ${ch.token}` }, signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && data?.id) return { ok: true, detail: `Connected — ${(data.name as string) || ch.name}.` };
    const err = (data?.error as { code?: number; message?: string }) ?? null;
    if (err?.code === 190) return { ok: false, detail: "The Page access token is invalid or expired — generate a fresh one and save again." };
    return { ok: false, detail: err?.message ? `Meta couldn't verify this: ${err.message}` : "Meta couldn't verify this Facebook Page connection." };
  } catch {
    return { ok: false, detail: "Couldn't reach Meta to verify right now — try again in a moment." };
  }
}

// Live check of the tenant's AI key (one cheap generation). Used by the explicit
// "Test" button — the status sweep only reports configured/not to stay fast.
export async function verifyAiLive(tenantId: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const ai = await resolveTenantAi(tenantId);
    await validateKey(ai.provider, ai.apiKey, ai.model);
    return { ok: true, detail: `Working — ${ai.provider} · ${ai.model} responded.` };
  } catch (e) {
    if (e instanceof AiKeyMissingError) return { ok: false, detail: "No AI key added yet — add one in Settings." };
    return { ok: false, detail: `The AI provider rejected the key: ${errorMessage(e)}` };
  }
}

// The full per-tenant setup checklist — PLAN-AWARE. We only ask the tenant to
// set up the channels & tools their subscription actually includes (an
// Instagram-only Creator is never asked for WhatsApp). The plan's first included
// channel is the required one to go live; the rest are optional "add when ready".
// WhatsApp / Instagram / Messenger are verified live against Meta.
export async function getSetupChecklist(tenantId: string): Promise<SetupChecklist> {
  const [channels, ent] = await Promise.all([
    listChannels(tenantId).catch(() => [] as Channel[]),
    getEntitlements(tenantId).catch(() => null),
  ]);
  // Use the resolved plan feature-map directly (independent of the enforcement
  // kill-switch): the wizard is guidance about the plan, not an access gate.
  const has = (k: FeatureKey) => !ent || ent.features[k] === true;

  const wa = channels.filter(c => (c.kind ?? "whatsapp") === "whatsapp");
  const ig = channels.filter(c => c.kind === "instagram");
  const fb = channels.filter(c => c.kind === "messenger");
  const web = channels.filter(c => c.kind === "webchat");

  type ChannelDef = { feat: FeatureKey; key: SetupStep["key"]; short: string; build: () => Promise<SetupStep> | SetupStep };
  const channelDefs: ChannelDef[] = [
    { feat: "ch_whatsapp", key: "whatsapp", short: "WhatsApp", build: async () => {
      if (!wa.length) return { key: "whatsapp", title: "WhatsApp number", status: "todo", detail: "No WhatsApp number connected yet.", hint: "Tap “Connect with Facebook” to set it up in one click — or paste the IDs from Meta.", fixTab: "settings" };
      const v = await verifyWhatsApp(wa.find(c => c.isDefault) ?? wa[0]);
      return { key: "whatsapp", title: "WhatsApp number", status: v.ok ? "ok" : "error", detail: v.detail, hint: v.ok ? undefined : "Reconnect in Settings → Channels.", fixTab: "settings" };
    } },
    { feat: "ch_instagram", key: "instagram", short: "Instagram", build: async () => {
      if (!ig.length) return { key: "instagram", title: "Instagram", status: "todo", detail: "Not connected yet.", hint: "Connect your Instagram professional account to handle DMs and comment-to-DM from one inbox.", fixTab: "instagram" };
      const v = await verifyInstagram(ig.find(c => c.isDefault) ?? ig[0]);
      return { key: "instagram", title: "Instagram", status: v.ok ? "ok" : "error", detail: v.detail, hint: v.ok ? undefined : "Reconnect in the Instagram tab.", fixTab: "instagram" };
    } },
    { feat: "ch_messenger", key: "messenger", short: "Messenger", build: async () => {
      if (!fb.length) return { key: "messenger", title: "Facebook Messenger", status: "todo", detail: "Not connected yet.", hint: "Connect your Facebook Page to auto-reply to Messenger DMs and comments.", fixTab: "facebook" };
      const v = await verifyMessenger(fb.find(c => c.isDefault) ?? fb[0]);
      return { key: "messenger", title: "Facebook Messenger", status: v.ok ? "ok" : "error", detail: v.detail, hint: v.ok ? undefined : "Reconnect in the Messenger tab.", fixTab: "facebook" };
    } },
    { feat: "ch_webchat", key: "webchat", short: "Web chat", build: () => {
      if (!web.length) return { key: "webchat", title: "Website web chat", status: "todo", detail: "No web-chat widget yet.", hint: "Create a widget and paste the one-line snippet on your site — no Meta setup needed.", fixTab: "webchat" };
      return { key: "webchat", title: "Website web chat", status: "ok", detail: `Widget ready${web.length > 1 ? ` (${web.length})` : ""} — paste the snippet on your site to go live.`, fixTab: "webchat" };
    } },
  ];

  const includedDefs = channelDefs.filter(d => has(d.feat));
  const primaryKey = includedDefs[0]?.key;

  const steps: SetupStep[] = [];
  // Channel steps — only the ones the plan grants; primary is required, rest optional.
  for (const d of includedDefs) {
    const step = await d.build();
    step.optional = d.key !== primaryKey;
    steps.push(step);
  }

  // AI key + knowledge base — only when the plan includes AI auto-replies.
  if (has("ai_autoreply")) {
    const ai = await getTenantAiStatus(tenantId).catch(() => ({ configured: false, provider: "gemini", model: "", keyHint: null }));
    steps.push(ai.configured
      ? { key: "ai", title: "AI assistant key", status: "ok", detail: `Configured — ${ai.provider} · ${ai.model || "default model"}.`, fixTab: "aihub" }
      : { key: "ai", title: "AI assistant key", status: "todo", detail: "No AI key added — automatic replies are off.", hint: "Add your AI provider key (Gemini, OpenAI or Anthropic) so the assistant can answer customers.", fixTab: "aihub" });

    const docs = await listDocuments(tenantId).catch(() => []);
    const ready = docs.filter(d => d.status === "ready").length;
    steps.push(!docs.length
      ? { key: "kb", title: "Knowledge base", status: "warn", optional: true, detail: "No documents added — the AI has nothing to answer from.", hint: "Upload your brochure, FAQ, or website so replies are grounded in your business.", fixTab: "assistant" }
      : { key: "kb", title: "Knowledge base", status: ready ? "ok" : "warn", optional: true, detail: `${ready}/${docs.length} document${docs.length === 1 ? "" : "s"} ready.`, hint: ready ? undefined : "Some documents are still processing or failed — open the Knowledge Base tab.", fixTab: "assistant" });
  }

  // CRM & tools — optional, only when the plan includes CRM sync. Satisfied by
  // ANY connected integration (HubSpot, Pipedrive, LeadSquared, Slack, Sheets…).
  if (has("crm")) {
    const integrations = await listIntegrations(tenantId).catch(() => []);
    const active = integrations.filter(i => i.active);
    const errored = active.filter(i => i.status === "error");
    steps.push(!active.length
      ? { key: "crm", title: "Connect your CRM & tools", status: "todo", optional: true, detail: "Not connected (optional).", hint: "Connect your CRM or tools — HubSpot, Pipedrive, LeadSquared, Slack, Google Sheets, webhooks and more — so chats and leads flow into the systems you already use.", fixTab: "integrations" }
      : { key: "crm", title: "Connect your CRM & tools", status: errored.length ? "warn" : "ok", optional: true, detail: errored.length ? `${active.length} connected · ${errored.length} need attention` : `${active.length} connected.`, hint: errored.length ? "An integration reported an error — open Integrations to check it." : undefined, fixTab: "integrations" });
  }

  const planRow = ent ? await getPlan(ent.plan).catch(() => null) : null;
  const plan: SetupPlanSummary = {
    key: ent?.plan ?? "trial",
    name: planRow?.name ?? (ent?.plan ? ent.plan.charAt(0).toUpperCase() + ent.plan.slice(1) : "Trial"),
    includedChannels: includedDefs.map(d => ({ key: d.key, label: d.short })),
  };

  return { steps, plan };
}

// Back-compat: the live "Test" verifier (and owner views) consume just the steps.
export async function getSetupStatus(tenantId: string): Promise<SetupStep[]> {
  return (await getSetupChecklist(tenantId)).steps;
}

// Lightweight per-tenant health rollup for the platform-owner view — DB reads
// ONLY (no external API calls), so it's cheap across many tenants. "error" when
// a required integration is missing OR a WhatsApp number is flagged by Meta
// (recorded passively from webhooks); "warn" when the KB is empty.
export interface TenantHealth {
  whatsapp: { configured: boolean; flag: string | null };
  instagram: { configured: boolean };
  ai: { configured: boolean };
  kb: { ready: number; total: number };
  crm: { configured: boolean };
  integrations: { active: number; errored: number };
  health: StepStatus;
}

export async function getTenantHealthSummary(tenantId: string): Promise<TenantHealth> {
  const [channels, ai, docs, lsq, integrations] = await Promise.all([
    listChannels(tenantId).catch(() => [] as Channel[]),
    getTenantAiStatus(tenantId).catch(() => ({ configured: false, provider: "gemini" as const, model: "", keyHint: null })),
    listDocuments(tenantId).catch(() => []),
    resolveLsq(tenantId).catch(() => null),
    integrationsHealth(tenantId).catch(() => ({ total: 0, active: 0, errored: 0 })),
  ]);
  const wa = channels.filter(c => (c.kind ?? "whatsapp") === "whatsapp");
  const ig = channels.filter(c => c.kind === "instagram");
  const flagged = wa.find(c => c.qualityRating === "RED" || c.messagingHealth === "FLAGGED" || c.messagingHealth === "RESTRICTED");
  const flag = flagged ? (flagged.qualityRating === "RED" ? "quality RED" : flagged.messagingHealth) : null;
  const ready = docs.filter(d => d.status === "ready").length;

  const health: StepStatus =
    (!wa.length || !ai.configured || flag) ? "error"
    : (!ready || integrations.errored > 0) ? "warn"
    : "ok";

  return {
    whatsapp: { configured: !!wa.length, flag },
    instagram: { configured: !!ig.length },
    ai: { configured: !!ai.configured },
    kb: { ready, total: docs.length },
    crm: { configured: !!lsq },
    integrations: { active: integrations.active, errored: integrations.errored },
    health,
  };
}
