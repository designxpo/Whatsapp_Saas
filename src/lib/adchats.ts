// AI ad-builder chat history — save / list / load / delete past conversations
// with the campaign builder, tenant-scoped. Powers the "chat history" sidebar.
// Stores the message list + the last drafted plan so a session reopens exactly
// where it was left. Content is capped so a pasted brief can't bloat a row.

import { tdb } from "./tenantdb";
import { DEFAULT_TENANT_ID } from "./tenant";

export interface AdChatMessage { role: "user" | "assistant"; content: string; doc?: string }
export interface AdChatSessionMeta { id: string; title: string; updatedAt: string }
export interface AdChatSession extends AdChatSessionMeta { messages: AdChatMessage[]; plan: unknown | null }

const TABLE = "wa_ad_chat_sessions";
const MAX_MESSAGES = 80;
const MAX_CONTENT = 20_000;

function cleanMessages(raw: unknown): AdChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_MESSAGES).map(m => {
    const o = (m ?? {}) as Record<string, unknown>;
    const role = o.role === "assistant" ? "assistant" as const : "user" as const;
    const content = String(o.content ?? "").slice(0, MAX_CONTENT);
    const doc = o.doc ? String(o.doc).slice(0, 200) : undefined;
    return doc ? { role, content, doc } : { role, content };
  }).filter(m => m.content.trim() || m.doc);
}

// A readable title from the first USER turn, stripping our injected brief prefix.
function deriveTitle(messages: AdChatMessage[]): string {
  const first = messages.find(m => m.role === "user" && (m.doc || m.content.trim()));
  if (!first) return "New campaign chat";
  if (first.doc) return first.doc.replace(/\.(pdf|docx?|txt|md)$/i, "").slice(0, 80);
  const base = first.content.replace(/^I've attached my prepared ad brief[\s\S]*/i, "Prepared brief").trim();
  return base.slice(0, 80) || "New campaign chat";
}

export async function listAdChats(tenantId = DEFAULT_TENANT_ID): Promise<AdChatSessionMeta[]> {
  const { data } = await tdb(tenantId).from(TABLE).select("id,title,updated_at").order("updated_at", { ascending: false }).limit(50);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
    id: r.id as string, title: (r.title as string) || "New campaign chat", updatedAt: r.updated_at as string,
  }));
}

export async function getAdChat(id: string, tenantId = DEFAULT_TENANT_ID): Promise<AdChatSession | null> {
  const { data } = await tdb(tenantId).from(TABLE).select("id,title,messages,plan,updated_at").eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  return {
    id: r.id as string, title: (r.title as string) || "New campaign chat", updatedAt: r.updated_at as string,
    messages: cleanMessages(r.messages), plan: (r.plan as unknown) ?? null,
  };
}

// Upsert: with an id it updates that session, otherwise it creates a new one and
// returns its id (the client then reuses it for subsequent saves in the session).
export async function saveAdChat(input: { id?: string | null; messages: unknown; plan?: unknown }, tenantId = DEFAULT_TENANT_ID): Promise<{ id: string }> {
  const messages = cleanMessages(input.messages);
  const title = deriveTitle(messages);
  const now = new Date().toISOString();
  const t = tdb(tenantId);
  if (input.id) {
    await t.from(TABLE).update({ title, messages, plan: input.plan ?? null, updated_at: now }).eq("id", input.id);
    return { id: input.id };
  }
  const { data, error } = await t.from(TABLE).insert({ title, messages, plan: input.plan ?? null, updated_at: now }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Could not save the chat");
  return { id: (data as { id: string }).id };
}

export async function deleteAdChat(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await tdb(tenantId).from(TABLE).delete().eq("id", id);
}
