// Resolves a tenant's OWN chat AI configuration (provider + model + key).
// Policy: REQUIRE-OWN-KEY — if a tenant hasn't configured a key, AI chat is off
// for them (resolveTenantAi throws AiKeyMissingError; callers escalate to human).
// Embeddings are unaffected — they run on the platform Gemini key in kb.ts.

import { getTenantSetting, setTenantSetting, getTenantSecret, setTenantSecret } from "../store";
import { DEFAULT_CHAT_MODEL, type AiProvider } from "./chat";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

const PROVIDER_SETTING = "ai_chat_provider";
const MODEL_SETTING = "ai_chat_model";
const KEY_SECRET = "ai_chat_key";

const PROVIDERS: AiProvider[] = ["gemini", "openai", "anthropic"];
function isProvider(v: string | null): v is AiProvider { return !!v && (PROVIDERS as string[]).includes(v); }

export class AiKeyMissingError extends Error {
  constructor() { super("No AI chat key configured for this tenant"); this.name = "AiKeyMissingError"; }
}

export interface TenantAi { provider: AiProvider; apiKey: string; model: string }

// Throws AiKeyMissingError when the tenant has no key. `modelOverride` (an
// agent's pinned model) wins over the tenant default when provided.
export async function resolveTenantAi(tenantId = DEFAULT_TENANT_ID, modelOverride?: string | null): Promise<TenantAi> {
  const apiKey = await getTenantSecret(tenantId, KEY_SECRET);
  if (!apiKey) throw new AiKeyMissingError();
  const rawProvider = await getTenantSetting<string | null>(tenantId, PROVIDER_SETTING, null);
  const provider: AiProvider = isProvider(rawProvider) ? rawProvider : "gemini";
  const savedModel = await getTenantSetting<string | null>(tenantId, MODEL_SETTING, null);
  const model = modelOverride?.trim() || savedModel?.trim() || DEFAULT_CHAT_MODEL[provider];
  return { provider, apiKey, model };
}

// Masked status for the settings UI (never returns the key itself).
export async function getTenantAiStatus(tenantId = DEFAULT_TENANT_ID): Promise<{ configured: boolean; provider: AiProvider; model: string; keyHint: string | null }> {
  const apiKey = await getTenantSecret(tenantId, KEY_SECRET);
  const rawProvider = await getTenantSetting<string | null>(tenantId, PROVIDER_SETTING, null);
  const provider: AiProvider = isProvider(rawProvider) ? rawProvider : "gemini";
  const savedModel = await getTenantSetting<string | null>(tenantId, MODEL_SETTING, null);
  const model = savedModel?.trim() || DEFAULT_CHAT_MODEL[provider];
  return {
    configured: !!apiKey,
    provider,
    model,
    keyHint: apiKey ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : null,
  };
}

export async function saveTenantAi(tenantId: string, provider: AiProvider, apiKey: string, model: string | null): Promise<void> {
  await setTenantSetting(tenantId, PROVIDER_SETTING, provider);
  await setTenantSetting(tenantId, MODEL_SETTING, (model?.trim() || DEFAULT_CHAT_MODEL[provider]));
  await setTenantSecret(tenantId, KEY_SECRET, apiKey);
}

export async function clearTenantAi(tenantId: string): Promise<void> {
  await setTenantSecret(tenantId, KEY_SECRET, "");
}
