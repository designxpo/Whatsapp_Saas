// "Which AI persona would answer this?" — the AI Hub preview. Runs the same
// checks and the same routing rule (aihub.decideRoute) as a live message, and
// explains the outcome in plain words, with every persona's fit score.

import { embedQuery } from "./kb";
import { decideRoute, isAutoRouteEnabled, scoreAgents, ROUTING_THRESHOLDS, type AgentScore } from "./aihub";
import { getIsolation } from "./isolation";

export interface RoutePreview {
  /** The persona that would answer, or null when routing wouldn't switch. */
  answeredBy: { agentId: string; name: string } | null;
  /** True when this message would move the chat to a different persona. */
  switches: boolean;
  why: string;
  scores: { agentId: string; name: string; score: number }[];
  thresholds: { minSimilarity: number; switchMargin: number };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Explain a routing decision for a set of scores. Pure. */
export function explainRoute(scored: AgentScore[], currentAgentId: string | null, currentName: string | null): Omit<RoutePreview, "thresholds"> {
  const d = decideRoute(scored, currentAgentId);
  const scores = scored.map(s => ({ ...s, score: Math.round(s.score * 1000) / 1000 }));
  const stay = currentAgentId ? { agentId: currentAgentId, name: currentName ?? "the current persona" } : null;
  if (d.pick) {
    const switches = d.pick.agentId !== currentAgentId;
    return {
      answeredBy: { agentId: d.pick.agentId, name: d.pick.name }, switches, scores,
      why: d.reason === "already_best"
        ? `${d.pick.name} is already the best fit (${pct(d.pick.score)}), so it keeps answering.`
        : `${d.pick.name} fits this message best (${pct(d.pick.score)}).${switches && currentName ? ` The chat moves from ${currentName}.` : ""}`,
    };
  }
  const why = d.reason === "too_few_agents"
    ? "Routing needs at least two personas with a description. Add a description and routing keywords to each persona."
    : d.reason === "no_good_fit"
      ? `No persona fits this well enough (best: ${d.best ? `${d.best.name} at ${pct(d.best.score)}` : "none"}; needs ${pct(ROUTING_THRESHOLDS.minSimilarity)}).${stay ? ` ${stay.name} keeps answering.` : " The channel's default persona answers."}`
      : `${d.best?.name} fits slightly better, but not by enough to switch mid-chat (needs ${pct(ROUTING_THRESHOLDS.switchMargin)} more).${stay ? ` ${stay.name} keeps answering.` : ""}`;
  return { answeredBy: stay, switches: false, why, scores };
}

export async function previewRoute(tenantId: string, message: string, current: { id: string; name: string } | null): Promise<RoutePreview> {
  const thresholds = ROUTING_THRESHOLDS;
  const none = (why: string): RoutePreview => ({ answeredBy: current ? { agentId: current.id, name: current.name } : null, switches: false, why, scores: [], thresholds });
  const iso = await getIsolation(tenantId);
  if (iso.active) return none("Your workspace keeps each business separate, so personas never switch automatically — each channel uses the persona pinned to it.");
  if (!(await isAutoRouteEnabled(tenantId))) return none("Automatic routing is off, so every chat uses its channel's persona (or the one a teammate picks). Turn on auto-routing to let the best-fit persona answer.");
  let embedding: number[];
  try { embedding = await embedQuery(message, tenantId); }
  catch { return none("Couldn't check right now — the AI service didn't respond. Try again in a moment."); }
  return { ...explainRoute(await scoreAgents(embedding, tenantId), current?.id ?? null, current?.name ?? null), thresholds };
}
