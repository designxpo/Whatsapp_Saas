// AI Hub — agent personas, function-calling lead capture, agent-assist prompts.
// The active agent's persona/constraints shape the bot's system prompt, and the
// active functions become Gemini tools: the model extracts structured data
// (name, phone, problem…) mid-conversation; we save it to contact attributes,
// optionally POST it to a webhook, and optionally escalate to a human.

import { db } from "./supabase";
import { setContactAttributes, getSetting, setSetting } from "./store";
import { embedTexts } from "./kb";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AiAgent {
  id: string; name: string; description: string; persona: string;
  constraintsText: string; productInfo: string; model: string | null;
  active: boolean; routingKeywords: string; hasEmbedding: boolean; updatedAt: string;
}
export interface AiFunctionParam { name: string; description: string; required: boolean; saveToAttribute: string }
export interface AiFunction {
  id: string; name: string; description: string; parameters: AiFunctionParam[];
  webhookUrl: string | null; escalate: boolean; active: boolean;
}
export interface AiPrompt { id: string; name: string; prompt: string; active: boolean; sort: number }

const mapAgent = (r: Record<string, unknown>): AiAgent => ({
  id: r.id as string, name: r.name as string, description: (r.description as string) ?? "",
  persona: (r.persona as string) ?? "", constraintsText: (r.constraints_text as string) ?? "",
  productInfo: (r.product_info as string) ?? "", model: (r.model as string | null) ?? null,
  active: (r.active as boolean) ?? false,
  routingKeywords: (r.routing_keywords as string) ?? "",
  hasEmbedding: Array.isArray(r.embedding),
  updatedAt: r.updated_at as string,
});
const mapFn = (r: Record<string, unknown>): AiFunction => ({
  id: r.id as string, name: r.name as string, description: (r.description as string) ?? "",
  parameters: (r.parameters as AiFunctionParam[]) ?? [],
  webhookUrl: (r.webhook_url as string | null) ?? null,
  escalate: (r.escalate as boolean) ?? false, active: (r.active as boolean) ?? true,
});

// ── Agents ────────────────────────────────────────────────────────────────────
export async function listAgents(): Promise<AiAgent[]> {
  const { data } = await db().from("wa_ai_agents").select("*").order("created_at");
  return (data ?? []).map(r => mapAgent(r as Record<string, unknown>));
}

export async function getActiveAgent(): Promise<AiAgent | null> {
  const { data } = await db().from("wa_ai_agents").select("*").eq("active", true).limit(1).maybeSingle();
  return data ? mapAgent(data as Record<string, unknown>) : null;
}

export async function getAgentById(id: string): Promise<AiAgent | null> {
  const { data } = await db().from("wa_ai_agents").select("*").eq("id", id).maybeSingle();
  return data ? mapAgent(data as Record<string, unknown>) : null;
}

// Routing: the conversation's pinned agent wins; otherwise the active agent.
export async function resolveAgent(agentId?: string | null): Promise<AiAgent | null> {
  if (agentId) {
    const pinned = await getAgentById(agentId).catch(() => null);
    if (pinned) return pinned;
  }
  return getActiveAgent();
}

export async function saveAgent(p: Partial<AiAgent> & { name: string }): Promise<AiAgent> {
  // Routing embedding from what the agent handles. Best-effort: a failed embed
  // (rate limit) saves the agent anyway; it just won't auto-route until re-saved.
  let embedding: number[] | null = null;
  const routingText = `${p.name}. ${p.description ?? ""}. ${p.routingKeywords ?? ""}`.trim();
  if (routingText.length > p.name.length + 3) {
    try { [embedding] = await embedTexts([routingText], "RETRIEVAL_QUERY"); }
    catch (e) { console.error("[aihub] agent embed failed:", e); }
  }
  const row = {
    name: p.name, description: p.description ?? "", persona: p.persona ?? "",
    constraints_text: p.constraintsText ?? "", product_info: p.productInfo ?? "",
    model: p.model || null, active: p.active ?? false,
    routing_keywords: p.routingKeywords ?? "",
    ...(embedding ? { embedding } : {}),
    updated_at: new Date().toISOString(),
  };
  if (p.active) await db().from("wa_ai_agents").update({ active: false }).neq("id", p.id ?? "00000000-0000-0000-0000-000000000000");
  const q = p.id
    ? db().from("wa_ai_agents").update(row).eq("id", p.id).select().single()
    : db().from("wa_ai_agents").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapAgent(data as Record<string, unknown>);
}

// ── Auto-routing: pick the best-fit agent for a query embedding ──────────────
const ROUTE_MIN_SIMILARITY = 0.35;   // below this nothing matches well — keep current
const ROUTE_SWITCH_MARGIN = 0.04;    // hysteresis: switch only on a clearly better fit

export async function isAutoRouteEnabled(): Promise<boolean> {
  return (await getSetting<{ auto?: boolean }>("agent_routing", {})).auto === true;
}
export async function setAutoRoute(auto: boolean): Promise<void> {
  await setSetting("agent_routing", { auto });
}

// Persona tone for FAQ/cache answers — ON by default (raw FAQ text reads robotic).
export async function isToneEnabled(): Promise<boolean> {
  return (await getSetting<{ enabled?: boolean }>("faq_tone", {})).enabled !== false;
}
export async function setToneEnabled(enabled: boolean): Promise<void> {
  await setSetting("faq_tone", { enabled });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Returns the agent the conversation should use for this query, or null to
// keep the current behavior. Sticky: switching needs a clear margin over the
// conversation's current agent so chat doesn't ping-pong between personas.
export async function pickAgentForQuery(queryEmbedding: number[], currentAgentId: string | null): Promise<{ agentId: string; name: string; score: number } | null> {
  const { data } = await db().from("wa_ai_agents").select("id, name, embedding").not("embedding", "is", null);
  const scored = (data ?? [])
    .map(r => ({ agentId: r.id as string, name: r.name as string, score: cosine(queryEmbedding, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score);
  if (scored.length < 2) return null;                       // routing needs alternatives

  const best = scored[0];
  if (best.score < ROUTE_MIN_SIMILARITY) return null;       // off-topic for everyone
  if (!currentAgentId) return best;
  if (best.agentId === currentAgentId) return best;
  const current = scored.find(s => s.agentId === currentAgentId);
  if (current && best.score - current.score < ROUTE_SWITCH_MARGIN) return null; // not clearly better
  return best;
}

export async function deleteAgent(id: string): Promise<void> {
  const { error } = await db().from("wa_ai_agents").delete().eq("id", id);
  if (error) throw error;
}

// ── Functions ─────────────────────────────────────────────────────────────────
export async function listFunctions(activeOnly = false): Promise<AiFunction[]> {
  let q = db().from("wa_ai_functions").select("*").order("created_at");
  if (activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []).map(r => mapFn(r as Record<string, unknown>));
}

export async function saveFunction(p: Partial<AiFunction> & { name: string }): Promise<void> {
  const name = p.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 50);
  const row = {
    name, description: p.description ?? "",
    parameters: (p.parameters ?? []).filter(x => x.name?.trim()).map(x => ({
      name: x.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      description: x.description ?? "", required: !!x.required,
      saveToAttribute: (x.saveToAttribute ?? "").trim(),
    })),
    webhook_url: p.webhookUrl?.trim() || null, escalate: !!p.escalate, active: p.active ?? true,
  };
  const q = p.id
    ? db().from("wa_ai_functions").update(row).eq("id", p.id)
    : db().from("wa_ai_functions").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deleteFunction(id: string): Promise<void> {
  const { error } = await db().from("wa_ai_functions").delete().eq("id", id);
  if (error) throw error;
}

// Gemini tool declarations for the active functions.
export function toGeminiTools(fns: AiFunction[]): { functionDeclarations: { name: string; description: string; parameters: Record<string, unknown> }[] } | null {
  if (fns.length === 0) return null;
  return {
    functionDeclarations: fns.map(f => ({
      name: f.name,
      description: f.description || f.name,
      parameters: {
        type: "OBJECT",
        properties: Object.fromEntries(f.parameters.map(pm => [pm.name, { type: "STRING", description: pm.description || pm.name }])),
        required: f.parameters.filter(pm => pm.required).map(pm => pm.name),
      },
    })),
  };
}

// Executes one function call from the model: save attributes → webhook → escalate.
// Never throws — returns a result object the model can read.
export async function executeAiFunction(fn: AiFunction, args: Record<string, unknown>, phone?: string): Promise<{ status: string; escalate: boolean }> {
  const collected: Record<string, string> = {};
  for (const pm of fn.parameters) {
    const v = args[pm.name];
    if (typeof v === "string" && v.trim() && pm.saveToAttribute) collected[pm.saveToAttribute] = v.trim().slice(0, 300);
  }
  if (phone && Object.keys(collected).length > 0) {
    await setContactAttributes(phone, collected).catch(e => console.error("[aihub] attr save:", e));
  }
  if (fn.webhookUrl) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch(fn.webhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ function: fn.name, phone: phone ?? null, data: args, savedAttributes: collected, at: new Date().toISOString() }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch (e) { console.error("[aihub] webhook:", e); }
  }
  console.log(JSON.stringify({ tag: "ai_function", fn: fn.name, phone, saved: Object.keys(collected), escalate: fn.escalate }));
  return { status: "saved", escalate: fn.escalate };
}

// ── Prompts (agent assist) ────────────────────────────────────────────────────
export async function listPrompts(activeOnly = false): Promise<AiPrompt[]> {
  let q = db().from("wa_ai_prompts").select("*").order("sort").order("created_at");
  if (activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []).map(r => ({
    id: r.id as string, name: r.name as string, prompt: r.prompt as string,
    active: (r.active as boolean) ?? true, sort: (r.sort as number) ?? 0,
  }));
}

export async function savePrompt(p: Partial<AiPrompt> & { name: string; prompt: string }): Promise<void> {
  const row = { name: p.name.trim(), prompt: p.prompt.trim(), active: p.active ?? true, sort: p.sort ?? 0 };
  const q = p.id ? db().from("wa_ai_prompts").update(row).eq("id", p.id) : db().from("wa_ai_prompts").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function deletePrompt(id: string): Promise<void> {
  const { error } = await db().from("wa_ai_prompts").delete().eq("id", id);
  if (error) throw error;
}
