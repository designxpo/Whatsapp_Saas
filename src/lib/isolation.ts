// Business isolation — one persona and one knowledge base per channel, and no
// fallback that lets one business speak in another's words.
//
// A workspace can run several businesses side by side: a spiritual channel on
// YouTube and Instagram, the product's own website chat, a personal portfolio.
// Each channel can pin its own AI persona and its own knowledge tag. The trap
// was everything a channel did NOT pin: it fell back to the workspace's single
// "active" persona and to the whole knowledge base. So the product's website
// chat spoke in the spiritual persona and answered a stranger's exam paper (Oct
// 2026), and a channel with no knowledge tag could read every business's
// documents.
//
// When a workspace is partitioned (see isolationActive), the fallbacks change:
//   • no pinned persona (or one that was deleted) → a neutral assistant, never
//     the "active" persona;
//   • no knowledge tag → no knowledge, never the whole library;
//   • a tag stays a boundary — it never widens;
//   • no cross-persona auto-routing, no shared FAQ/cache across businesses.
// A workspace with one persona and one knowledge base is untouched.

import { listChannels } from "./channels";
import { listAgents } from "./aihub";
import { getTenantSetting } from "./store";

export type IsolationMode = "auto" | "on" | "off";
export const ISOLATION_KEY = "ai_isolation";

export interface IsolationView { mode: IsolationMode; active: boolean }

export interface ChannelAllocation { id: string; name: string; kind: string; agentId: string | null; kbTag: string | null }

/** The assistant a channel gets when it has not chosen a persona — no business voice at all. */
export const NEUTRAL_AGENT = {
  name: "Neutral assistant",
  model: null as string | null,
  persona: [
    "You are the AI assistant for the business that owns this chat. You have no personal name and no brand voice of your own.",
    "Greet people warmly and answer only from the Business context. If it does not contain the answer, say you don't have that and offer to connect them with the team.",
  ].join("\n"),
  constraintsText: "Only talk about this business and what the Business context covers. Never invent facts. Never answer tasks unrelated to this business.",
  productInfo: "",
};

/**
 * Is this workspace partitioned? Pure. "on"/"off" are the owner's override; "auto"
 * decides from how the channels are set up: two or more distinct knowledge tags,
 * or two or more distinct pinned personas, means the owner has split their
 * channels into separate businesses. One Sales + one Support persona on a single
 * brand, with nothing pinned, is NOT a partition, so it keeps working as before.
 */
export function isolationActive(mode: IsolationMode, channels: Pick<ChannelAllocation, "agentId" | "kbTag">[]): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  const tags = new Set(channels.map(c => c.kbTag).filter(Boolean));
  const agents = new Set(channels.map(c => c.agentId).filter(Boolean));
  return tags.size >= 2 || agents.size >= 2;
}

export interface ChannelIssue { code: "no-persona" | "persona-missing" | "no-knowledge"; text: string }

/** What a channel is missing for the isolation to hold. Pure. */
export function channelIssues(c: ChannelAllocation, agentIds: Set<string>): ChannelIssue[] {
  const out: ChannelIssue[] = [];
  if (!c.agentId) out.push({ code: "no-persona", text: "No AI persona — it uses a neutral assistant" });
  else if (!agentIds.has(c.agentId)) out.push({ code: "persona-missing", text: "Its persona was deleted — it uses a neutral assistant" });
  if (!c.kbTag) out.push({ code: "no-knowledge", text: "No knowledge tag — the AI has no documents to answer from" });
  return out;
}

const cache = new Map<string, { at: number; v: IsolationView }>();
const TTL = 30_000;

export function clearIsolationCache(tenantId?: string) { tenantId ? cache.delete(tenantId) : cache.clear(); }

export async function getIsolation(tenantId: string): Promise<IsolationView> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: IsolationView = { mode: "auto", active: false };
  try {
    const mode = await getTenantSetting<IsolationMode>(tenantId, ISOLATION_KEY, "auto");
    const m: IsolationMode = mode === "on" || mode === "off" ? mode : "auto";
    const channels = (await listChannels(tenantId)).filter(c => c.active);
    v = { mode: m, active: isolationActive(m, channels) };
  } catch { /* unreadable → behave as before rather than break replies */ }
  cache.set(tenantId, { at: Date.now(), v });
  return v;
}

export async function isolationReport(tenantId: string) {
  const [view, channels, agents] = await Promise.all([getIsolation(tenantId), listChannels(tenantId), listAgents(tenantId)]);
  const ids = new Set(agents.map(a => a.id));
  const names = new Map(agents.map(a => [a.id, a.name]));
  return {
    ...view,
    channels: channels.filter(c => c.active).map(c => ({
      id: c.id, name: c.name, kind: c.kind,
      persona: c.agentId ? names.get(c.agentId) ?? null : null,
      knowledge: c.kbTag,
      issues: channelIssues({ id: c.id, name: c.name, kind: c.kind, agentId: c.agentId, kbTag: c.kbTag }, ids),
    })),
  };
}
