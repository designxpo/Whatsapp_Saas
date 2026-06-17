// Per-tenant setup/health status. Powers the in-portal Setup wizard: each
// integration is checked LIVE (Meta Graph for WhatsApp/Instagram, the AI
// provider for the key) and reported in plain English so a tenant can self-
// serve onboarding and immediately see — and fix — what's wrong. Tenant-scoped
// throughout; one tenant's broken config never touches another's.

import { listChannels, type Channel } from "./channels";
import { getTenantAiStatus, resolveTenantAi, AiKeyMissingError } from "./ai/keys";
import { validateKey } from "./ai/chat";
import { listDocuments } from "./store";
import { resolveLsq, verifyLsq } from "./leadsquared";
import { errorMessage } from "./errors";

const GRAPH = "https://graph.facebook.com/v22.0";

export type StepStatus = "ok" | "warn" | "todo" | "error";
export interface SetupStep {
  key: "whatsapp" | "instagram" | "ai" | "kb" | "crm";
  title: string;
  status: StepStatus;
  detail: string;        // plain-English current state
  hint?: string;         // plain-English next step (only when not ok)
  fixTab?: string;       // portal tab where the tenant fixes it
  optional?: boolean;
}

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

// The full per-tenant setup checklist, with WhatsApp/Instagram verified live.
export async function getSetupStatus(tenantId: string): Promise<SetupStep[]> {
  const channels = await listChannels(tenantId).catch(() => [] as Channel[]);
  const wa = channels.filter(c => (c.kind ?? "whatsapp") === "whatsapp");
  const ig = channels.filter(c => c.kind === "instagram");
  const steps: SetupStep[] = [];

  // 1) WhatsApp — required.
  if (!wa.length) {
    steps.push({ key: "whatsapp", title: "WhatsApp number", status: "todo",
      detail: "No WhatsApp number connected yet.",
      hint: "Connect your WhatsApp Business number so you can send and receive messages.", fixTab: "settings" });
  } else {
    const def = wa.find(c => c.isDefault) ?? wa[0];
    const v = await verifyWhatsApp(def);
    steps.push({ key: "whatsapp", title: "WhatsApp number", status: v.ok ? "ok" : "error", detail: v.detail,
      hint: v.ok ? undefined : "Re-enter the token / Phone Number ID in Settings → Channels.", fixTab: "settings" });
  }

  // 2) AI key — required for auto-replies (configured/not; "Test" does a live call).
  const ai = await getTenantAiStatus(tenantId).catch(() => ({ configured: false, provider: "gemini", model: "", keyHint: null }));
  if (!ai.configured) {
    steps.push({ key: "ai", title: "AI assistant key", status: "todo",
      detail: "No AI key added — automatic replies are off.",
      hint: "Add your AI provider key (Gemini, OpenAI or Anthropic) so the assistant can answer customers.", fixTab: "settings" });
  } else {
    steps.push({ key: "ai", title: "AI assistant key", status: "ok",
      detail: `Configured — ${ai.provider} · ${ai.model || "default model"}.`, fixTab: "settings" });
  }

  // 3) Knowledge base — recommended (the AI answers from it).
  const docs = await listDocuments(tenantId).catch(() => []);
  const ready = docs.filter(d => d.status === "ready").length;
  if (!docs.length) {
    steps.push({ key: "kb", title: "Knowledge base", status: "warn",
      detail: "No documents added — the AI has nothing to answer from.",
      hint: "Upload your brochure, FAQ, or website so replies are grounded in your business.", fixTab: "assistant" });
  } else {
    steps.push({ key: "kb", title: "Knowledge base", status: ready ? "ok" : "warn",
      detail: `${ready}/${docs.length} document${docs.length === 1 ? "" : "s"} ready.`,
      hint: ready ? undefined : "Some documents are still processing or failed — open the Knowledge Base tab.", fixTab: "assistant" });
  }

  // 4) Instagram — optional.
  if (!ig.length) {
    steps.push({ key: "instagram", title: "Instagram", status: "todo", optional: true,
      detail: "Not connected (optional).",
      hint: "Connect Instagram to handle DMs and comment-to-DM from the same inbox.", fixTab: "instagram" });
  } else {
    const def = ig.find(c => c.isDefault) ?? ig[0];
    const v = await verifyInstagram(def);
    steps.push({ key: "instagram", title: "Instagram", status: v.ok ? "ok" : "error", detail: v.detail, optional: true,
      hint: v.ok ? undefined : "Re-enter the Instagram token / account ID in Settings.", fixTab: "instagram" });
  }

  // 5) LeadSquared CRM — optional, verified live (read-only).
  const lsq = await resolveLsq(tenantId).catch(() => null);
  if (!lsq) {
    steps.push({ key: "crm", title: "LeadSquared CRM", status: "todo", optional: true,
      detail: "Not connected (optional).",
      hint: "Add your LeadSquared keys to sync every chat onto the lead's timeline and pull stage/owner into Live Chat.", fixTab: "settings" });
  } else {
    const v = await verifyLsq(tenantId);
    steps.push({ key: "crm", title: "LeadSquared CRM", status: v.ok ? "ok" : "error", detail: v.detail, optional: true,
      hint: v.ok ? undefined : "Check your Access Key, Secret Key and API host in Settings → LeadSquared.", fixTab: "settings" });
  }

  return steps;
}
