// Chatbot flow engine — executes drag-and-drop flows built in /admin (Flows tab).
//
// Runs BEFORE the Knowledge Router/AI in the webhook: if a flow handles the
// message, the AI stays silent; if not (no trigger, no option match), the
// message falls through to the RAG assistant — a smarter fallback than the
// "I didn't understand" dead-ends in AiSensy/Interakt.
//
// Graph model (stored as jsonb on wa_flows.graph):
//   nodes: [{ id, type, position:{x,y}, data:{...} }]
//   edges: [{ id, source, sourceHandle?, target }]
// Node types: start | message | buttons | list | media | ask | condition |
//             hours | tag | webhook | product | agent | handoff | end

import { db } from "./supabase";
import {
  sendText, sendButtons, sendList, sendMedia, sendProduct,
} from "./whatsapp";
import { sendWaFormMessage } from "./waforms";
import { sendIgMessage } from "./instagram";
import { getChannel, type Channel, type ChannelCreds } from "./channels";
import {
  appendConvMessage, touchOutbound, setConversationStatus, setBotEnabled,
  setContactAttributes, getContactByPhone, claimReply, setConversationAgent,
  addContactTag,
} from "./store";
import { recordFormSent, markFormAbandoned } from "./formresponses";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Options whose label reads like a human-handoff request — used to auto-escalate
// when such a button is left unconnected in the builder (instead of dead-ending).
const AGENT_OPT_RE = /\b(agent|human|representative|support|person|talk to|speak to|connect)\b/i;

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface FlowEdge { id: string; source: string; sourceHandle?: string | null; target: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }
export interface Flow {
  id: string; name: string; active: boolean; triggerKeywords: string[];
  platform: "whatsapp" | "instagram";   // which channel kind this flow runs on
  channelId: string | null;     // scope to one number/account (null = every one of that platform)
  graph: FlowGraph; createdAt: string; updatedAt: string;
}

const SESSION_TTL_MS = 24 * 3600 * 1000;
const MAX_STEPS = 25;                       // loop guard per inbound message
const norm = (s: string) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// ── CRUD ──────────────────────────────────────────────────────────────────────
function mapFlow(r: Record<string, unknown>): Flow {
  return {
    id: r.id as string, name: r.name as string, active: (r.active as boolean) ?? false,
    triggerKeywords: (r.trigger_keywords as string[]) ?? [],
    platform: (r.platform as Flow["platform"]) ?? "whatsapp",
    channelId: (r.channel_id as string | null) ?? null,
    graph: (r.graph as FlowGraph) ?? { nodes: [], edges: [] },
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export async function listFlows(tenantId = DEFAULT_TENANT_ID): Promise<Flow[]> {
  const { data } = await db().from("wa_flows").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapFlow(r as Record<string, unknown>));
}

// tenantId optional: bot path resolves a flow by id under the channel's tenant;
// admin routes pass the session tenant to scope access.
export async function getFlow(id: string, tenantId?: string): Promise<Flow | null> {
  let q = db().from("wa_flows").select("*").eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return data ? mapFlow(data as Record<string, unknown>) : null;
}

export async function createFlow(name: string, tenantId = DEFAULT_TENANT_ID): Promise<Flow> {
  const starter: FlowGraph = {
    nodes: [{ id: "start", type: "start", position: { x: 60, y: 200 }, data: {} }],
    edges: [],
  };
  const { data, error } = await db().from("wa_flows").insert({ tenant_id: tenantId, name, graph: starter }).select().single();
  if (error) throw error;
  return mapFlow(data as Record<string, unknown>);
}

export async function updateFlow(id: string, p: Partial<{ name: string; active: boolean; triggerKeywords: string[]; platform: "whatsapp" | "instagram"; channelId: string | null; graph: FlowGraph }>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) patch.name = p.name;
  if (p.active !== undefined) patch.active = p.active;
  if (p.triggerKeywords !== undefined) patch.trigger_keywords = p.triggerKeywords.map(k => norm(k)).filter(Boolean);
  if (p.platform !== undefined) patch.platform = p.platform;
  if (p.channelId !== undefined) patch.channel_id = p.channelId;
  if (p.graph !== undefined) patch.graph = p.graph;
  let { error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id);
  // Optional columns missing (migration not applied) — save the rest.
  if (error && ("channel_id" in patch || "platform" in patch)) {
    delete patch.channel_id; delete patch.platform;
    ({ error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id));
  }
  if (error) throw error;
}

export async function deleteFlow(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_flows").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
interface Session { conversationId: string; flowId: string; currentNode: string; state: Record<string, unknown> }

async function getSession(convKey: string): Promise<Session | null> {
  const { data } = await db().from("wa_flow_sessions").select("*").eq("conversation_id", convKey).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.updated_at as string).getTime() > SESSION_TTL_MS) {
    await endSession(convKey);
    return null;
  }
  return { conversationId: convKey, flowId: data.flow_id as string, currentNode: data.current_node as string, state: (data.state as Record<string, unknown>) ?? {} };
}

async function saveSession(convKey: string, flowId: string, nodeId: string, state: Record<string, unknown>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_flow_sessions").upsert(
    { tenant_id: tenantId, conversation_id: convKey, flow_id: flowId, current_node: nodeId, state, updated_at: new Date().toISOString() },
    { onConflict: "conversation_id" },
  );
}

export async function endSession(convKey: string): Promise<void> {
  await db().from("wa_flow_sessions").delete().eq("conversation_id", convKey);
}

// ── Sender abstraction: real WhatsApp vs dry-run simulator ───────────────────
export interface FlowSender {
  text(body: string): Promise<{ id?: string; error?: string }>;
  buttons(body: string, buttons: { id: string; title: string }[]): Promise<{ id?: string; error?: string }>;
  list(body: string, buttonText: string, sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]): Promise<{ id?: string; error?: string }>;
  media(kind: "image" | "video" | "document", url: string, caption?: string): Promise<{ id?: string; error?: string }>;
  product(body: string, catalogId: string, productId: string): Promise<{ id?: string; error?: string }>;
  waform(body: string, cta: string, formId: string): Promise<{ id?: string; error?: string }>;
}

function realSender(conversationId: string, phone: string, channel?: ChannelCreds, tenantId = DEFAULT_TENANT_ID): FlowSender {
  const log = async (body: string, metaId?: string) => {
    if (!metaId) return;
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  return {
    async text(body) { const r = await sendText(phone, body, channel); await log(body, r.id); return r; },
    async buttons(body, buttons) { const r = await sendButtons(phone, body, buttons, channel); await log(`${body}\n[buttons: ${buttons.map(b => b.title).join(" | ")}]`, r.id); return r; },
    async list(body, buttonText, sections) { const r = await sendList(phone, body, buttonText, sections, channel); await log(`${body}\n[list: ${sections.flatMap(s => s.rows.map(x => x.title)).join(" | ")}]`, r.id); return r; },
    async media(kind, url, caption) { const r = await sendMedia(phone, kind, url, caption, channel); await log(`[${kind}] ${caption ?? url}`, r.id); return r; },
    async product(body, catalogId, productId) { const r = await sendProduct(phone, body, catalogId, productId, channel); await log(`[product ${productId}] ${body}`, r.id); return r; },
    async waform(body, cta, formId) { const r = await sendWaFormMessage(phone, { formId, bodyText: body, cta }, channel); await log(`${body}\n[form: ${cta}]`, r.id); return r; },
  };
}

// Instagram sender — IG messaging is text-only for our purposes, so buttons/
// lists render as a numbered text menu (branching still works because the user
// taps/types the option label, which matchOption resolves). Sends respect the
// 24h window (the flow runs right after the inbound, so it's open).
function igSender(conversationId: string, phone: string, channel: Channel, tenantId = DEFAULT_TENANT_ID): FlowSender {
  const creds = { igUserId: channel.igUserId ?? "", token: channel.token };
  const log = async (body: string, metaId?: string) => {
    if (!metaId) return;
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  const sendIg = async (body: string): Promise<{ id?: string; error?: string }> => {
    const r = await sendIgMessage(creds, phone, body, { lastInboundAt: new Date().toISOString() });
    await log(body, r.messageId);
    return { id: r.messageId, error: r.error };
  };
  const menu = (body: string, opts: string[]) => sendIg(opts.length ? `${body}\n\n${opts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : body);
  return {
    async text(body) { return sendIg(body); },
    async buttons(body, buttons) { return menu(body, buttons.map(b => b.title)); },
    async list(body, _buttonText, sections) { return menu(body, sections.flatMap(s => s.rows.map(r => r.title))); },
    async media(_kind, url, caption) { return sendIg(caption ? `${caption}\n${url}` : url); },
    async product(body) { return sendIg(body); },
    async waform(body, cta) { return sendIg(`${body}\n(${cta})`); },
  };
}

export interface SimOutput { kind: string; body: string; options?: string[] }
export function drySender(out: SimOutput[]): FlowSender {
  const ok = async () => ({ id: `sim_${out.length}` });
  return {
    async text(body) { out.push({ kind: "text", body }); return ok(); },
    async buttons(body, buttons) { out.push({ kind: "buttons", body, options: buttons.map(b => b.title) }); return ok(); },
    async list(body, _bt, sections) { out.push({ kind: "list", body, options: sections.flatMap(s => s.rows.map(r => r.title)) }); return ok(); },
    async media(kind, url, caption) { out.push({ kind, body: caption ?? url }); return ok(); },
    async product(body, _c, productId) { out.push({ kind: "product", body: `${body} (product: ${productId})` }); return ok(); },
    async waform(body, cta, _formId) { out.push({ kind: "waform", body: `${body}\n📋 [${cta}] — opens the WhatsApp form; reply "[form] test" here to simulate a submission` }); return ok(); },
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────
function nodeById(g: FlowGraph, id: string): FlowNode | undefined { return g.nodes.find(n => n.id === id); }
function nextNode(g: FlowGraph, from: string, handle?: string): FlowNode | undefined {
  const e = g.edges.find(x => x.source === from && (handle === undefined || (x.sourceHandle ?? "next") === handle || x.sourceHandle == null));
  return e ? nodeById(g, e.target) : undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

type ListSection = { title: string; rows: { id: string; title: string; description?: string }[] };

// The builder stores flat `rows`; older graphs may carry full `sections`.
// Normalize to sections and enforce Meta's 10-row cap either way.
function listSections(d: Record<string, unknown>): ListSection[] {
  const fromSections = (d.sections as ListSection[]) ?? [];
  if (fromSections.length) {
    let budget = 10;
    return fromSections.map(s => {
      const rows = (s.rows ?? []).filter(r => r.title?.trim()).slice(0, Math.max(0, budget));
      budget -= rows.length;
      return { ...s, rows };
    }).filter(s => s.rows.length > 0);
  }
  const rows = ((d.rows as { id: string; title: string; description?: string }[]) ?? []).filter(r => r.title?.trim()).slice(0, 10);
  return rows.length ? [{ title: "", rows }] : [];
}

// Sends nodes starting at `node` until the flow waits for input or ends.
// `menuNodeId`: the interactive node this run branched from — when the branch
// dead-ends (no outgoing edge, no explicit End node), the session returns
// there so the user can still pick the other menu options.
// Returns true if the conversation is now (or was) inside the flow.
async function runFrom(flow: Flow, node: FlowNode | undefined, convKey: string, phone: string, send: FlowSender, isReal: boolean, menuNodeId?: string | null, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const g = flow.graph;
  let steps = 0;
  let cur = node;
  while (cur && steps++ < MAX_STEPS) {
    const d = cur.data ?? {};
    switch (cur.type) {
      case "start":
        cur = nextNode(g, cur.id); continue;
      case "message": {
        await send.text(str(d.text) || "…");
        cur = nextNode(g, cur.id); continue;
      }
      case "sequence": {
        // Multi-send: several texts/media fire back-to-back, no trigger between them.
        const parts = ((d.parts as { kind?: string; text?: string; url?: string; caption?: string }[]) ?? []).slice(0, 10);
        for (const p of parts) {
          const kind = p.kind || "text";
          if (kind === "text") { if (p.text?.trim()) await send.text(p.text); }
          else if (p.url?.trim()) await send.media(kind as "image" | "video" | "document", p.url, p.caption?.trim() || undefined);
        }
        cur = nextNode(g, cur.id); continue;
      }
      case "media": {
        const kind = (str(d.kind) || "image") as "image" | "video" | "document";
        if (str(d.url)) await send.media(kind, str(d.url), str(d.caption) || undefined);
        cur = nextNode(g, cur.id); continue;
      }
      case "product": {
        if (str(d.catalogId) && str(d.productId)) await send.product(str(d.text) || "Check this out:", str(d.catalogId), str(d.productId));
        cur = nextNode(g, cur.id); continue;
      }
      case "buttons": {
        const buttons = ((d.buttons as { id: string; title: string }[]) ?? []).filter(b => b.title?.trim()).slice(0, 3);
        if (buttons.length === 0) { cur = nextNode(g, cur.id); continue; }
        await send.buttons(str(d.text) || "Choose an option:", buttons);
        await saveSession(convKey, flow.id, cur.id, menuNodeId ? { menu: menuNodeId } : {}, tenantId);
        return true;
      }
      case "list": {
        const sections = listSections(d);
        if (sections.length === 0) { cur = nextNode(g, cur.id); continue; }
        await send.list(str(d.text) || "Pick one:", str(d.buttonText) || "Options", sections);
        await saveSession(convKey, flow.id, cur.id, menuNodeId ? { menu: menuNodeId } : {}, tenantId);
        return true;
      }
      case "ask": {
        await send.text(str(d.question) || "Please type your answer:");
        await saveSession(convKey, flow.id, cur.id, menuNodeId ? { menu: menuNodeId } : {}, tenantId);
        return true;
      }
      case "waform": {
        // Native WhatsApp form — waits until the submission webhook arrives
        // (the answers are saved to contact attributes by the webhook).
        if (!str(d.formId)) { cur = nextNode(g, cur.id); continue; }
        await send.waform(str(d.text) || "Please fill this quick form:", str(d.cta) || "Open form", str(d.formId));
        if (isReal) await recordFormSent(convKey, phone, str(d.formId), tenantId).catch(() => undefined);
        await saveSession(convKey, flow.id, cur.id, menuNodeId ? { menu: menuNodeId } : {}, tenantId);
        return true;
      }
      case "agent": {
        // Pin this conversation to a specific AI Hub agent for all future AI replies.
        if (isReal && str(d.agentId)) await setConversationAgent(convKey, str(d.agentId)).catch(() => undefined);
        cur = nextNode(g, cur.id); continue;
      }
      case "condition": {
        let match = false;
        if (isReal && str(d.attribute)) {
          const contact = await getContactByPhone(phone, tenantId).catch(() => null);
          const val = norm(String(contact?.attributes?.[str(d.attribute)] ?? ""));
          const want = norm(str(d.value));
          match = str(d.op) === "contains" ? (want !== "" && val.includes(want)) : val === want;
        }
        cur = nextNode(g, cur.id, match ? "yes" : "no"); continue;
      }
      case "hours": {
        // Business-hours branch (IST). Route 'open' inside the window, 'closed' outside.
        const start = Number(d.start ?? 10), end = Number(d.end ?? 19);
        const istHour = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
        const open = start < end ? istHour >= start && istHour < end : istHour >= start || istHour < end;
        cur = nextNode(g, cur.id, open ? "open" : "closed"); continue;
      }
      case "tag": {
        if (isReal && str(d.tag)) await addContactTag(phone, str(d.tag), tenantId).catch(() => undefined);
        cur = nextNode(g, cur.id); continue;
      }
      case "webhook": {
        // Notify an external system (CRM, sheet, Zapier…) — fire-and-forget.
        const url = str(d.url);
        if (isReal && /^https?:\/\//.test(url)) {
          const contact = await getContactByPhone(phone, tenantId).catch(() => null);
          void fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "flow_webhook", flow: flow.name, flowId: flow.id, node: cur.id,
              phone, name: contact?.name ?? "", tags: contact?.tags ?? [], attributes: contact?.attributes ?? {},
              at: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => undefined);
        }
        cur = nextNode(g, cur.id); continue;
      }
      case "handoff": {
        if (str(d.text)) await send.text(str(d.text));
        if (isReal) {
          await setConversationStatus(convKey, "escalated").catch(() => undefined);
          await setBotEnabled(convKey, false).catch(() => undefined);
        }
        await endSession(convKey);
        return true;
      }
      case "end":
      default:
        await endSession(convKey);
        return true;
    }
  }
  // Dead end (branch with no continuation) — go back to the menu we came from
  // so the remaining options keep working; only an End node closes the flow.
  if (menuNodeId) await saveSession(convKey, flow.id, menuNodeId, {}, tenantId);
  else await endSession(convKey);
  return true;
}

// Match an inbound reply against the interactive node the session is waiting on.
function matchOption(node: FlowNode, text: string): string | null {
  const t = norm(text);
  if (!t) return null;
  if (node.type === "buttons") {
    for (const b of ((node.data.buttons as { id: string; title: string }[]) ?? [])) {
      if (norm(b.title) === t || norm(b.id) === t) return b.id;
    }
  }
  if (node.type === "list") {
    for (const r of listSections(node.data).flatMap(s => s.rows)) {
      if (norm(r.title) === t || norm(r.id) === t) return r.id;
    }
  }
  return null;
}

// The human-readable label of a menu option, for intent checks (e.g. agent).
function optionLabel(node: FlowNode, optionId: string): string {
  if (node.type === "buttons") return ((node.data.buttons as { id: string; title: string }[]) ?? []).find(b => b.id === optionId)?.title ?? "";
  if (node.type === "list") return listSections(node.data).flatMap(s => s.rows).find(r => r.id === optionId)?.title ?? "";
  return "";
}

// Main entry — called from the webhook for every inbound message (and from the
// simulator). Returns true when the flow consumed the message.
export async function handleFlowMessage(
  convKey: string,
  phone: string,
  text: string,
  opts: { sender?: FlowSender; onlyFlowId?: string; allowInactive?: boolean; channel?: Channel; adFlowId?: string; tenantId?: string } = {},
): Promise<boolean> {
  const tid = opts.tenantId ?? opts.channel?.tenantId ?? DEFAULT_TENANT_ID;
  const send = opts.sender ?? (opts.channel?.kind === "instagram"
    ? igSender(convKey, phone, opts.channel, tid)
    : realSender(convKey, phone, opts.channel, tid));
  const isReal = !opts.sender;

  // 1. Continue an in-progress session.
  const session = await getSession(convKey);
  if (session) {
    const flow = await getFlow(session.flowId, tid);
    if (!flow) { await endSession(convKey); return false; }
    const waiting = nodeById(flow.graph, session.currentNode);
    if (!waiting) { await endSession(convKey); return false; }

    // Menu rewind: while waiting anywhere, tapping an option of the menu this
    // branch came from re-runs that branch (users tap old buttons constantly).
    const rewind = async (): Promise<boolean | null> => {
      const menuId = str(session.state?.menu);
      const menuNode = menuId ? nodeById(flow.graph, menuId) : undefined;
      if (!menuNode) return null;
      const opt = matchOption(menuNode, text);
      if (!opt) return null;
      const consumed = await runFrom(flow, nextNode(flow.graph, menuNode.id, opt), convKey, phone, send, isReal, menuNode.id, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      return consumed;
    };

    if (waiting.type === "ask") {
      // An old menu tap takes priority over treating it as the answer.
      const rewound = await rewind();
      if (rewound !== null) return rewound;
      const attr = str(waiting.data.attribute);
      if (isReal && attr) await setContactAttributes(phone, { [attr]: text.slice(0, 200) }, tid).catch(() => undefined);
      const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      return consumed;
    }

    if (waiting.type === "waform") {
      // Continue only on the form submission (webhook renders it as "[form] …").
      if (text.startsWith("[form]")) {
        const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
        if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
        return consumed;
      }
      // Old menu tap → rewind; anything else → the user moved on without
      // submitting: mark the form abandoned (once) + note it in chat. AI answers.
      const rewound = await rewind();
      if (rewound !== null) return rewound;
      if (isReal && await markFormAbandoned(convKey, tid)) {
        await appendConvMessage({ conversationId: convKey, role: "assistant", body: "[form-abandoned]", source: "bot", tenantId: tid }).catch(() => undefined);
      }
      return false;
    }

    const optionId = matchOption(waiting, text);
    if (optionId) {
      const next = nextNode(flow.graph, waiting.id, optionId);
      // Safety net: an unconnected "talk to agent/human" option escalates to a
      // human instead of silently dead-ending back to the menu.
      if (!next && AGENT_OPT_RE.test(optionLabel(waiting, optionId))) {
        if (isReal) {
          await send.text("Connecting you with our team — someone will reply here shortly. 🙌");
          await setConversationStatus(convKey, "escalated").catch(() => undefined);
          await setBotEnabled(convKey, false).catch(() => undefined);
          await claimReply(convKey).catch(() => undefined);
        }
        await endSession(convKey);
        return true;
      }
      // Branch runs carry the menu node along — dead-ended branches return to it.
      const consumed = await runFrom(flow, next, convKey, phone, send, isReal, waiting.id, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      return consumed;
    }
    // Not an option of the current menu — maybe one from the menu before it.
    const rewound = await rewind();
    if (rewound !== null) return rewound;
    // Off-script reply — leave the session waiting and let the AI answer.
    return false;
  }

  // 2a. No session, but the lead came from an ad bound to a flow → start it.
  // The CTWA referral only arrives on the first inbound, so this fires once,
  // and takes precedence over keywords (the first message is rarely a keyword).
  if (opts.adFlowId && !opts.onlyFlowId) {
    const flow = await getFlow(opts.adFlowId, tid);
    if (flow && (flow.active || opts.allowInactive) && (!flow.channelId || !opts.channel || flow.channelId === opts.channel.id)) {
      const start = flow.graph.nodes.find(n => n.type === "start");
      const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      if (consumed) return true;
    }
  }

  // 2b. No session — does this message trigger a flow? Flows fire only on their
  // platform (WhatsApp vs Instagram), and number-scoped flows only on that one.
  const platform = opts.channel?.kind ?? "whatsapp";
  const flows = (opts.onlyFlowId
    ? [await getFlow(opts.onlyFlowId, tid)].filter((f): f is Flow => !!f && (opts.allowInactive || f.active))
    : (await listFlows(tid)).filter(f => f.active)
  ).filter(f => (f.platform ?? "whatsapp") === platform)
   .filter(f => !f.channelId || !opts.channel || f.channelId === opts.channel.id);
  const t = norm(text);
  for (const flow of flows) {
    if (!flow.triggerKeywords.some(k => k === t)) continue;
    const start = flow.graph.nodes.find(n => n.type === "start");
    const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
    if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
    return consumed;
  }
  return false;
}

// ── No-reply reminders (called from the cron) ─────────────────────────────────
// Waiting blocks (buttons/list/ask) can set reminderMinutes + reminderText:
// if the customer hasn't answered after that long, send one nudge and keep
// waiting. One reminder per waiting step; replying or moving on resets it.
export async function drainFlowReminders(max = 50): Promise<number> {
  const { data } = await db().from("wa_flow_sessions").select("*").limit(500);
  let sent = 0;
  const flowCache = new Map<string, Flow | null>();
  for (const s of data ?? []) {
    if (sent >= max) break;
    const convKey = s.conversation_id as string;
    if (convKey.startsWith("sim:")) continue;                       // simulator sessions
    const state = ((s.state as Record<string, unknown>) ?? {});
    if (state.reminded) continue;

    const sTid = (s.tenant_id as string) ?? DEFAULT_TENANT_ID;
    if (!flowCache.has(s.flow_id as string)) flowCache.set(s.flow_id as string, await getFlow(s.flow_id as string, sTid));
    const flow = flowCache.get(s.flow_id as string);
    if (!flow?.active) continue;
    const node = nodeById(flow.graph, s.current_node as string);
    const mins = Number(node?.data?.reminderMinutes ?? 0);
    const text = str(node?.data?.reminderText);
    if (!node || !mins || !text.trim()) continue;
    if (Date.now() - new Date(s.updated_at as string).getTime() < mins * 60_000) continue;

    // Meta compliance: free-form sends only inside the 24h customer window.
    const { data: conv } = await db().from("wa_conversations").select("*").eq("id", convKey).maybeSingle();
    if (!conv?.phone || !conv.last_inbound_at) continue;
    if (Date.now() - new Date(conv.last_inbound_at as string).getTime() > 23.5 * 3600_000) continue;

    // Reply from the same number the chat lives on.
    const channel = conv.channel_id ? (await getChannel(conv.channel_id as string)) ?? undefined : undefined;
    const r = await realSender(convKey, conv.phone as string, channel, (conv.tenant_id as string) ?? sTid).text(text);
    // Mark reminded either way so a hard failure can't loop every cron tick.
    await db().from("wa_flow_sessions").update({ state: { ...state, reminded: true } }).eq("conversation_id", convKey);
    if (!r.error) sent++;
  }
  return sent;
}
