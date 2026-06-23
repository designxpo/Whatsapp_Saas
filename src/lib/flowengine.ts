import { DEFAULT_TENANT_ID } from "./tenant";
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
  sendText, sendButtons, sendList, sendMedia, sendProduct, sendProductList, sendCtaUrl, sendCarouselTemplate, sendTemplateSingle,
} from "./whatsapp";
import { sendWaFormMessage } from "./waforms";
import { sendIgMessage, sendIgQuickReplies } from "./instagram";
import { sendFbMessage, sendFbMedia, sendFbQuickReplies } from "./messenger";
import { getChannel, type Channel, type ChannelCreds } from "./channels";
import {
  appendConvMessage, touchOutbound, setConversationStatus,
  setContactAttributes, getContactByPhone, claimReply, setConversationAgent, setConversationKbTag,
  addContactTag, takeArmedFlow, updateContactProfile,
} from "./store";
import { recordFormSent, markFormAbandoned } from "./formresponses";
import { looksLikeCity } from "./llm";
import { getProduct } from "./commerce";
import { calcomSlots, calcomBook, matchSlot, extractEmail } from "./integrations";
import { safeFetch } from "./ssrf";


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
  platform: "whatsapp" | "instagram" | "messenger" | "both";   // which channel kind(s) this flow runs on
  channelId: string | null;     // scope to one number/account (null = every one of that platform)
  primaryKbTag: string | null;  // AI in this flow answers from KB docs with this tag first
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
    primaryKbTag: (r.primary_kb_tag as string | null) ?? null,
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

export async function updateFlow(id: string, p: Partial<{ name: string; active: boolean; triggerKeywords: string[]; platform: "whatsapp" | "instagram" | "messenger" | "both"; channelId: string | null; primaryKbTag: string | null; graph: FlowGraph }>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) patch.name = p.name;
  if (p.active !== undefined) patch.active = p.active;
  if (p.triggerKeywords !== undefined) patch.trigger_keywords = p.triggerKeywords.map(k => norm(k)).filter(Boolean);
  if (p.platform !== undefined) patch.platform = p.platform;
  if (p.channelId !== undefined) patch.channel_id = p.channelId;
  if (p.primaryKbTag !== undefined) patch.primary_kb_tag = p.primaryKbTag || null;
  if (p.graph !== undefined) patch.graph = p.graph;
  let { error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id);
  // Optional columns missing (migration not applied) — save the rest, but never
  // let an Instagram flow silently persist as WhatsApp-only: without the column
  // it would read back as "whatsapp" and never trigger on IG. Fail loudly.
  if (error && ("channel_id" in patch || "platform" in patch || "primary_kb_tag" in patch)) {
    const triedPlatform = patch.platform === "instagram" || patch.platform === "messenger" || patch.platform === "both";
    delete patch.channel_id; delete patch.platform; delete patch.primary_kb_tag;
    ({ error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id));
    if (!error && triedPlatform) throw new Error("This flow's platform setting needs the wa_flows.platform migrations applied (0023_flow_platform.sql + 0046_flow_platform_both.sql + 0062_flow_platform_messenger.sql), then save again.");
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
  // Custom product card: image + body + a button you label (vs the native
  // catalog card whose button Meta controls). buttonUrl is required by WhatsApp.
  productCard(body: string, imageUrl: string | null, buttonText: string, buttonUrl: string): Promise<{ id?: string; error?: string }>;
  productList(header: string, body: string, catalogId: string, sections: { title: string; productRetailerIds: string[] }[]): Promise<{ id?: string; error?: string }>;
  template(templateName: string, lang: string, bodyParams: string[], headerImageUrl?: string): Promise<{ id?: string; error?: string }>;
  carouselTemplate(templateName: string, lang: string, bubbleParams: string[], cards: { mediaUrl: string; kind?: "image" | "video"; bodyParams?: string[] }[]): Promise<{ id?: string; error?: string }>;
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
    async productCard(body, imageUrl, buttonText, buttonUrl) { const r = await sendCtaUrl(phone, body, buttonText, buttonUrl, channel, imageUrl ?? undefined); await log(`[product card] ${body}\n[${buttonText}] ${buttonUrl}`, r.id); return r; },
    async productList(header, body, catalogId, sections) { const r = await sendProductList(phone, header, body, catalogId, sections, channel); await log(`${body}\n[catalog: ${sections.flatMap(s => s.productRetailerIds).length} products]`, r.id); return r; },
    async template(templateName, lang, bodyParams, headerImageUrl) { const r = await sendTemplateSingle(phone, templateName, lang, bodyParams, channel, headerImageUrl); await log(`[template: ${templateName}${bodyParams.length ? ` · ${bodyParams.join(", ")}` : ""}]`, r.id); return r; },
    async carouselTemplate(templateName, lang, bubbleParams, cards) { const r = await sendCarouselTemplate(phone, templateName, lang, bubbleParams, cards, channel); await log(`[carousel template: ${templateName} · ${cards.length} cards]`, r.id); return r; },
    async waform(body, cta, formId) { const r = await sendWaFormMessage(phone, { formId, bodyText: body, cta }, channel); await log(`${body}\n[form: ${cta}]`, r.id); return r; },
  };
}

// Instagram sender — menu options render as tappable QUICK REPLIES (up to 13,
// titles ≤20 chars). If the options don't fit that (too many / too long), we
// fall back to a numbered text menu. Either way matchOption resolves the tap or
// the typed number. Sends respect the 24h window (the flow runs right after the
// inbound, so it's open).
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
  const numberedMenu = (body: string, opts: string[]) => sendIg(opts.length ? `${body}\n\n${opts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : body);
  // Tappable chips when they fit IG's limits; otherwise numbered text.
  const chips = async (body: string, options: { id: string; title: string }[]): Promise<{ id?: string; error?: string }> => {
    const fits = options.length > 0 && options.length <= 13 && options.every(o => o.title.length <= 20);
    if (!fits) return numberedMenu(body, options.map(o => o.title));
    const r = await sendIgQuickReplies(creds, phone, body, options.map(o => ({ title: o.title, payload: o.id })), { lastInboundAt: new Date().toISOString() });
    if (!r.ok) return numberedMenu(body, options.map(o => o.title));   // fallback if rejected
    await log(`${body}\n[options: ${options.map(o => o.title).join(" | ")}]`, r.messageId);
    return { id: r.messageId };
  };
  return {
    async text(body) { return sendIg(body); },
    async buttons(body, buttons) { return chips(body, buttons); },
    async list(body, _buttonText, sections) { return chips(body, sections.flatMap(s => s.rows.map(r => ({ id: r.id, title: r.title })))); },
    async media(_kind, url, caption) { return sendIg(caption ? `${caption}\n${url}` : url); },
    async product(body) { return sendIg(body); },
    async productCard(body, _imageUrl, buttonText, buttonUrl) { return sendIg(`${body}\n${buttonText}: ${buttonUrl}`); },
    // Instagram has no catalog/template messages — send the bubble text so the
    // flow still says something instead of going silent.
    async productList(header, body) { return sendIg([header, body].filter(s => s?.trim()).join("\n") || "Have a look:"); },
    async template(_templateName, _lang, bodyParams) { return bodyParams.length ? sendIg(bodyParams.join(" ")) : { id: "ig_noop" }; },
    async carouselTemplate(_templateName, _lang, bubbleParams) { return bubbleParams.length ? sendIg(bubbleParams.join(" ")) : { id: "ig_noop" }; },
    async waform(body, cta) { return sendIg(`${body}\n(${cta})`); },
  };
}

// Facebook Messenger sender — mirrors igSender. Menu options render as tappable
// QUICK REPLIES (≤13, titles ≤20 chars); when they don't fit, fall back to a
// numbered text menu (matchOption resolves the tapped payload or the typed
// number). Sends respect the 24h window (the flow runs right after the inbound,
// so it's open). conv.phone holds the PSID; creds come from the Page channel.
function fbSender(conversationId: string, phone: string, channel: Channel, tenantId = DEFAULT_TENANT_ID): FlowSender {
  const creds = { pageId: channel.pageId ?? "", token: channel.token };
  const now = () => new Date().toISOString();
  const log = async (body: string, metaId?: string) => {
    if (!metaId) return;
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  const sendFb = async (body: string): Promise<{ id?: string; error?: string }> => {
    const r = await sendFbMessage(creds, phone, body, { lastInboundAt: now() });
    await log(body, r.messageId);
    return { id: r.messageId, error: r.error };
  };
  const numberedMenu = (body: string, opts: string[]) => sendFb(opts.length ? `${body}\n\n${opts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : body);
  const chips = async (body: string, options: { id: string; title: string }[]): Promise<{ id?: string; error?: string }> => {
    const fits = options.length > 0 && options.length <= 13 && options.every(o => o.title.length <= 20);
    if (!fits) return numberedMenu(body, options.map(o => o.title));
    const r = await sendFbQuickReplies(creds, phone, body, options.map(o => ({ title: o.title, payload: o.id })), { lastInboundAt: now() });
    if (!r.ok) return numberedMenu(body, options.map(o => o.title));   // fallback if rejected
    await log(`${body}\n[options: ${options.map(o => o.title).join(" | ")}]`, r.messageId);
    return { id: r.messageId };
  };
  return {
    async text(body) { return sendFb(body); },
    async buttons(body, buttons) { return chips(body, buttons); },
    async list(body, _bt, sections) { return chips(body, sections.flatMap(s => s.rows.map(r => ({ id: r.id, title: r.title })))); },
    async media(kind, url, caption) {
      // Messenger media is image/video/audio by URL with no caption field, and has
      // no "document" kind — send a document as a text link instead.
      if (kind === "document") return sendFb(caption ? `${caption}\n${url}` : url);
      const r = await sendFbMedia(creds, phone, kind, url, { lastInboundAt: now() });
      await log(`[${kind}] ${url}`, r.messageId);
      if (caption?.trim()) await sendFb(caption);
      return { id: r.messageId, error: r.error };
    },
    async product(body) { return sendFb(body); },
    async productCard(body, _imageUrl, buttonText, buttonUrl) { return sendFb(`${body}\n${buttonText}: ${buttonUrl}`); },
    // Messenger has no catalog/template messages — send the text so the flow still
    // says something instead of going silent (same as Instagram).
    async productList(header, body) { return sendFb([header, body].filter(s => s?.trim()).join("\n") || "Have a look:"); },
    async template(_templateName, _lang, bodyParams) { return bodyParams.length ? sendFb(bodyParams.join(" ")) : { id: "fb_noop" }; },
    async carouselTemplate(_templateName, _lang, bubbleParams) { return bubbleParams.length ? sendFb(bubbleParams.join(" ")) : { id: "fb_noop" }; },
    async waform(body, cta) { return sendFb(`${body}\n(${cta})`); },
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
    async productCard(body, _imageUrl, buttonText, buttonUrl) { out.push({ kind: "product", body: `${body}\n🔘 [${buttonText || "View"}] → ${buttonUrl}` }); return ok(); },
    async productList(header, body, _c, sections) { out.push({ kind: "product_list", body: `🛍 ${[header, body].filter(s => s?.trim()).join(" — ")} (${sections.flatMap(s => s.productRetailerIds).length} catalog products, swipeable)` }); return ok(); },
    async template(templateName, _lang, bodyParams) { out.push({ kind: "template", body: `📄 Template “${templateName}”${bodyParams.length ? ` · ${bodyParams.join(", ")}` : ""}` }); return ok(); },
    async carouselTemplate(templateName, _lang, _bubbleParams, cards) { out.push({ kind: "carousel", body: `🎠 Carousel template “${templateName}” — ${cards.length} swipeable cards` }); return ok(); },
    async waform(body, cta, _formId) { out.push({ kind: "waform", body: `${body}\n📋 [${cta}] — opens the WhatsApp form; reply "[form] test" here to simulate a submission` }); return ok(); },
  };
}

// ── Engine ────────────────────────────────────────────────────────────────────
function nodeById(g: FlowGraph, id: string): FlowNode | undefined { return g.nodes.find(n => n.id === id); }
// Exported for unit tests — pure graph routing, no side effects.
export function nextNode(g: FlowGraph, from: string, handle?: string): FlowNode | undefined {
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

// ── Variable substitution ─────────────────────────────────────────────────────
// Flow text can reference the customer with {{...}}: {{name}}, {{phone}},
// {{email}}, or any collected attribute ({{city}}, {{course}}). Unknown tokens
// resolve to "" so a raw placeholder never leaks to the customer.
interface ContactVars { name?: string | null; phone?: string; email?: string | null; attributes?: Record<string, string> }
export function fillVars(text: string, c: ContactVars | null): string {
  if (!text || !c || !text.includes("{{")) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, raw: string) => {
    const key = raw.trim().toLowerCase();
    if (key === "name" || key === "firstname" || key === "first_name") return (c.name || "").trim().split(/\s+/)[0] || "";
    if (key === "fullname" || key === "full_name") return (c.name || "").trim();
    if (key === "phone" || key === "mobile") return c.phone || "";
    if (key === "email") return (c.email || "").trim();
    const attrs = c.attributes ?? {};
    const hit = Object.keys(attrs).find(k => k.toLowerCase() === key);
    return hit ? String(attrs[hit] ?? "") : "";
  });
}
// Wrap a sender so every customer-facing TEXT/body/caption is variable-filled.
// Option/row TITLES are left literal — option-matching reads them from node data,
// so a filled title could break the tap resolution.
function withVars(send: FlowSender, c: ContactVars | null): FlowSender {
  if (!c) return send;
  const f = (s: string) => fillVars(s, c);
  return {
    text: (b) => send.text(f(b)),
    buttons: (b, btns) => send.buttons(f(b), btns),
    list: (b, bt, sec) => send.list(f(b), bt, sec),
    media: (k, u, cap) => send.media(k, u, cap != null ? f(cap) : cap),
    product: (b, cat, p) => send.product(f(b), cat, p),
    productCard: (b, img, bt, bu) => send.productCard(f(b), img, f(bt), bu),
    productList: (h, b, cat, sec) => send.productList(f(h), f(b), cat, sec),
    template: (n, l, params, h) => send.template(n, l, params.map(f), h),
    carouselTemplate: (n, l, bp, cards) => send.carouselTemplate(n, l, bp.map(f), cards),
    waform: (b, cta, fid) => send.waform(f(b), f(cta), fid),
  };
}

// Validates an `ask` answer against the node's chosen rule. "city" uses a cheap
// AI check (best-effort, tenant's provider). Everything else is deterministic.
export async function validateInput(type: string, text: string, tenantId?: string): Promise<boolean> {
  const t = (text || "").trim();
  if (!t) return false;
  switch (type) {
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
    case "phone": return t.replace(/\D/g, "").length >= 7;
    case "number": return /^[\d\s,.\-+]+$/.test(t) && /\d/.test(t);
    case "city": return await looksLikeCity(t, tenantId);
    default: return true;
  }
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
        if (str(d.cardStyle) === "custom") {
          // Custom card: live-look up the catalog product so its image + button
          // (edited in the Catalog tab) are always current. Needs a button link.
          const prod = str(d.localProductId) ? await getProduct(str(d.localProductId), tenantId) : null;
          if (prod?.buttonUrl) {
            const price = `${prod.currency} ${(prod.priceCents / 100).toFixed(2)}`;
            const body = str(d.text) || [prod.name, price, prod.description].filter(Boolean).join("\n");
            await send.productCard(body, prod.imageUrl, prod.buttonText || "View", prod.buttonUrl);
          }
        } else if (str(d.catalogId) && str(d.productId)) {
          await send.product(str(d.text) || "Check this out:", str(d.catalogId), str(d.productId));
        }
        cur = nextNode(g, cur.id); continue;
      }
      case "template": {
        // Send an approved WhatsApp template (header image + {{n}} body params).
        const name = str(d.templateName).trim();
        if (name) {
          // A CAROUSEL template must be sent with per-card media — the standard
          // template send is rejected by Meta (silent failure). When the node
          // carries cards (it detected a carousel template), route accordingly.
          const cards = (((d.cards as { mediaUrl?: string; kind?: string; bodyParams?: string }[]) ?? [])
            .map(c => ({
              mediaUrl: str(c.mediaUrl).trim(),
              kind: (c.kind === "video" ? "video" : "image") as "image" | "video",
              bodyParams: str(c.bodyParams).split(",").map(s => s.trim()).filter(Boolean),
            }))
            .filter(c => c.mediaUrl));
          if (cards.length >= 2) {
            const bubbleParams = str(d.bubbleParams).split(",").map(s => s.trim()).filter(Boolean);
            await send.carouselTemplate(name, str(d.lang) || "en_US", bubbleParams, cards);
          } else {
            const params = ((d.bodyParams as string[]) ?? []).map(s => (s ?? "").trim());
            await send.template(name, str(d.lang) || "en_US", params, str(d.headerImageUrl).trim() || undefined);
          }
        }
        cur = nextNode(g, cur.id); continue;
      }
      case "productlist": {
        // Catalog product carousel: several products from one catalog, swipeable.
        const catalogId = str(d.catalogId).trim();
        const ids = str(d.products).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
        if (catalogId && ids.length) {
          const header = (str(d.header) || "Our products").slice(0, 60);
          await send.productList(header, str(d.text) || "Browse and tap to view:", catalogId, [{ title: header.slice(0, 24), productRetailerIds: ids }]);
        }
        cur = nextNode(g, cur.id); continue;
      }
      case "carouseltpl": {
        // Approved CAROUSEL template — 2–10 swipeable marketing cards. Each card's
        // media is supplied here (Meta requires it at send time).
        const name = str(d.templateName).trim();
        const cards = (((d.cards as { mediaUrl?: string; kind?: string; bodyParams?: string }[]) ?? [])
          .map(c => ({
            mediaUrl: str(c.mediaUrl).trim(),
            kind: (c.kind === "video" ? "video" : "image") as "image" | "video",
            bodyParams: str(c.bodyParams).split(",").map(s => s.trim()).filter(Boolean),
          }))
          .filter(c => c.mediaUrl));
        if (name && cards.length >= 2) {
          const bubbleParams = str(d.bubbleParams).split(",").map(s => s.trim()).filter(Boolean);
          await send.carouselTemplate(name, str(d.lang) || "en_US", bubbleParams, cards);
        }
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
      case "book": {
        // Cal.com booking — show available slots as a list, then book on the
        // user's pick (resume logic in handleFlowMessage). Skips gracefully when
        // no Cal.com integration is connected so the flow still continues.
        const tz = str(d.tz) || "Asia/Kolkata";
        if (!isReal) { await send.text("[booking] would show available Cal.com slots here."); cur = nextNode(g, cur.id); continue; }
        const slots = await calcomSlots(tenantId, { tz });
        if (slots === null) { if (str(d.fallback)) await send.text(str(d.fallback)); cur = nextNode(g, cur.id); continue; }
        if (!slots.length) { await send.text(str(d.fallback) || "Sorry, there are no open times in the next few days — our team will reach out to schedule."); cur = nextNode(g, cur.id); continue; }
        await send.list(str(d.text) || "Pick a time that works for you:", "Times", [{ title: "Available times", rows: slots.map(s => ({ id: s.id, title: s.label })) }]);
        const slotMap: Record<string, string> = {};
        for (const s of slots) slotMap[s.id] = s.iso;
        await saveSession(convKey, flow.id, cur.id, { step: "pickSlot", slots: slotMap, tz, ...(menuNodeId ? { menu: menuNodeId } : {}) }, tenantId);
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
          // SSRF guard (safeFetch) — tenant-supplied URL must resolve to a public host.
          void safeFetch(url, {
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
        // Flag the chat for a human, but DON'T turn the bot off — it keeps
        // answering follow-ups until a human actually replies from the inbox
        // (that's what pauses the bot). The AI/system never disables itself.
        if (isReal) await setConversationStatus(convKey, "escalated").catch(() => undefined);
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
// Exported for unit tests — pure.
export function matchOption(node: FlowNode, text: string): string | null {
  const t = norm(text);
  if (!t) return null;
  const opts: { id: string; title: string }[] =
    node.type === "buttons" ? ((node.data.buttons as { id: string; title: string }[]) ?? [])
    : node.type === "list" ? listSections(node.data).flatMap(s => s.rows)
    : [];
  // Exact title or id match (covers button taps and IG quick-reply taps).
  for (const o of opts) if (norm(o.title) === t || norm(o.id) === t) return o.id;
  // Numeric selection — IG (and any text-menu) users reply "1"/"2"/… to pick the
  // option by its listed position. Without this, typing a number never advanced.
  if (/^\d{1,2}$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= opts.length) return opts[n - 1].id;
  }
  return null;
}

// The human-readable label of a menu option, for intent checks (e.g. agent).
// Exported for unit tests — pure.
export function optionLabel(node: FlowNode, optionId: string): string {
  if (node.type === "buttons") return ((node.data.buttons as { id: string; title: string }[]) ?? []).find(b => b.id === optionId)?.title ?? "";
  if (node.type === "list") return listSections(node.data).flatMap(s => s.rows).find(r => r.id === optionId)?.title ?? "";
  return "";
}

// Main entry — called from the webhook for every inbound message (and from the
// simulator). Returns true when the flow consumed the message.
// Find an active flow on this platform whose exact trigger keyword matches the
// text, and start it. Returns true/false when a flow matched (consumed or not),
// or null when no keyword matched. Used both for the no-session case and to let
// a trigger keyword restart a flow even while a session is open.
async function triggerByKeyword(
  text: string, convKey: string, phone: string, send: FlowSender, isReal: boolean,
  opts: { onlyFlowId?: string; allowInactive?: boolean; channel?: Channel }, tid: string,
): Promise<boolean | null> {
  // Testing one specific flow (simulator): use it as-is. The simulator passes no
  // channel, so filtering by platform/channel here would wrongly exclude
  // Instagram flows — only apply those filters when routing real inbound traffic.
  let flows: Flow[];
  if (opts.onlyFlowId) {
    const f = await getFlow(opts.onlyFlowId, tid);
    flows = f && (opts.allowInactive || f.active) ? [f] : [];
  } else {
    const platform = opts.channel?.kind ?? "whatsapp";
    flows = (await listFlows(tid)).filter(f => f.active)
      .filter(f => f.platform === "both" || (f.platform ?? "whatsapp") === platform)
      .filter(f => !f.channelId || !opts.channel || f.channelId === opts.channel.id);
  }
  const t = norm(text);
  for (const flow of flows) {
    if (!flow.triggerKeywords.some(k => norm(k) === t)) continue;
    // Scope this chat's AI knowledge to the flow's primary tag (null clears it).
    if (isReal) await setConversationKbTag(convKey, flow.primaryKbTag).catch(() => undefined);
    const start = flow.graph.nodes.find(n => n.type === "start");
    const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
    if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
    return consumed;
  }
  return null;
}

export async function handleFlowMessage(
  convKey: string,
  phone: string,
  text: string,
  opts: { sender?: FlowSender; onlyFlowId?: string; allowInactive?: boolean; channel?: Channel; adFlowId?: string; tenantId?: string } = {},
): Promise<boolean> {
  const tid = opts.tenantId ?? opts.channel?.tenantId ?? DEFAULT_TENANT_ID;
  const baseSend = opts.sender ?? (opts.channel?.kind === "instagram"
    ? igSender(convKey, phone, opts.channel, tid)
    : opts.channel?.kind === "messenger"
    ? fbSender(convKey, phone, opts.channel, tid)
    : realSender(convKey, phone, opts.channel, tid));
  const isReal = !opts.sender;
  // Load the contact once so flow text can resolve {{name}}/{{city}}/{{course}}…
  // (kept up to date in-run as ask answers / menu picks are captured below).
  const contact = await getContactByPhone(phone, tid).catch(() => null);
  const send = withVars(baseSend, contact);

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
      // Validate the answer if the node requires it; on failure re-prompt and stay
      // put. Give up after 2 tries so a customer is never trapped on one question.
      const vtype = str(waiting.data.validate);
      const tries = Number((session.state as Record<string, unknown>)?.tries ?? 0);
      if (vtype && vtype !== "none" && tries < 2 && !(await validateInput(vtype, text, tid))) {
        if (isReal) {
          await send.text(str(waiting.data.retryText) || "Hmm, that doesn't look right — could you share a valid answer?");
          await saveSession(convKey, flow.id, waiting.id, { ...(session.state ?? {}), tries: tries + 1 }, tid);
          await claimReply(convKey).catch(() => undefined);
        }
        return true;   // still waiting on this ask node
      }
      const attr = str(waiting.data.attribute);
      if (isReal && attr) {
        await setContactAttributes(phone, { [attr]: text.slice(0, 200) }, tid).catch(() => undefined);
        if (contact) contact.attributes = { ...(contact.attributes ?? {}), [attr]: text.slice(0, 200) };  // live for {{attr}} this run
      }
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

    if (waiting.type === "book") {
      // An old menu tap takes priority over a slot pick.
      const rewound = await rewind();
      if (rewound !== null) return rewound;
      const state = session.state ?? {};
      const tz = str(state.tz) || "Asia/Kolkata";

      // Send the result and continue the flow (on success) or close the booking
      // session (on failure, so the user isn't stuck mid-booking).
      const finish = async (booked: boolean, email: string): Promise<boolean> => {
        await send.text(booked
          ? `✅ Booked! A calendar invite is on its way${email ? ` to ${email}` : ""}.`
          : "Sorry — I couldn't lock that slot in (it may have just been taken). Reply to start over and pick another time.");
        if (booked) {
          const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
          if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
          return consumed;
        }
        await endSession(convKey);
        if (isReal) await claimReply(convKey).catch(() => undefined);
        return true;
      };

      if (str(state.step) === "pickSlot") {
        const slots = (state.slots as Record<string, string>) ?? {};
        const chosen = matchSlot(text, Object.keys(slots));
        if (!chosen) return false;   // not a valid pick → let the AI field the question
        const startIso = slots[chosen];
        const contact = await getContactByPhone(phone, tid).catch(() => null);
        const attrEmail = Object.values(contact?.attributes ?? {}).map(v => extractEmail(String(v))).find(Boolean) ?? null;
        const email = contact?.email || attrEmail;
        if (email) return finish(await calcomBook(tid, { startIso, name: contact?.name || phone, email, tz }), email);
        await send.text("Great choice! What email should I send the calendar invite to?");
        await saveSession(convKey, flow.id, waiting.id, { step: "askEmail", startIso, tz, ...(state.menu ? { menu: state.menu } : {}) }, tid);
        if (isReal) await claimReply(convKey).catch(() => undefined);
        return true;
      }

      if (str(state.step) === "askEmail") {
        const email = extractEmail(text);
        if (!email) {
          await send.text("That doesn't look like an email — please reply with a valid email address.");
          if (isReal) await claimReply(convKey).catch(() => undefined);
          return true;
        }
        const startIso = str(state.startIso);
        const contact = await getContactByPhone(phone, tid).catch(() => null);
        if (isReal) await updateContactProfile(phone, { email }, tid).catch(() => undefined);
        return finish(await calcomBook(tid, { startIso, name: contact?.name || phone, email, tz }), email);
      }

      await endSession(convKey);
      return false;
    }

    const optionId = matchOption(waiting, text);
    if (optionId) {
      // Capture the chosen option onto a contact attribute (when the node sets
      // "saveAs") so later messages can reference it, e.g. {{course}}.
      const saveAs = str(waiting.data.saveAs);
      if (isReal && saveAs) {
        const label = optionLabel(waiting, optionId);
        if (label) {
          await setContactAttributes(phone, { [saveAs]: label }, tid).catch(() => undefined);
          if (contact) contact.attributes = { ...(contact.attributes ?? {}), [saveAs]: label };  // live for {{saveAs}} this run
        }
      }
      const next = nextNode(flow.graph, waiting.id, optionId);
      // Safety net: an unconnected "talk to agent/human" option escalates to a
      // human instead of silently dead-ending back to the menu.
      if (!next && AGENT_OPT_RE.test(optionLabel(waiting, optionId))) {
        if (isReal) {
          await send.text("Connecting you with our team — someone will reply here shortly. 🙌");
          await setConversationStatus(convKey, "escalated").catch(() => undefined);
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
    // Still off-script — but a trigger keyword should restart its flow even
    // mid-session (users resend "hi"/"menu" to start over). runFrom replaces the
    // open session; only genuinely off-script text falls through to the AI.
    const restarted = await triggerByKeyword(text, convKey, phone, send, isReal, opts, tid);
    if (restarted !== null) return restarted;
    return false;
  }

  // 2a. No session, but the lead came from an ad bound to a flow → start it.
  // The CTWA referral only arrives on the first inbound, so this fires once,
  // and takes precedence over keywords (the first message is rarely a keyword).
  if (opts.adFlowId && !opts.onlyFlowId) {
    const flow = await getFlow(opts.adFlowId, tid);
    if (flow && (flow.active || opts.allowInactive) && (!flow.channelId || !opts.channel || flow.channelId === opts.channel.id)) {
      if (isReal) await setConversationKbTag(convKey, flow.primaryKbTag).catch(() => undefined);
      const start = flow.graph.nodes.find(n => n.type === "start");
      const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      if (consumed) return true;
    }
  }

  // 2a-bis. No session — was this contact armed by a broadcast? Their first reply
  // after a "bot on broadcast" send starts that flow, regardless of keyword. Real
  // WhatsApp inbounds only (broadcasts are template sends); consumed once.
  if (isReal && !opts.onlyFlowId && opts.channel?.kind !== "instagram") {
    const armedId = await takeArmedFlow(phone, tid).catch(() => null);
    if (armedId) {
      const flow = await getFlow(armedId, tid);
      if (flow && flow.active && (!flow.channelId || !opts.channel || flow.channelId === opts.channel.id)) {
        await setConversationKbTag(convKey, flow.primaryKbTag).catch(() => undefined);
        const start = flow.graph.nodes.find(n => n.type === "start");
        const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
        if (consumed) { await claimReply(convKey).catch(() => undefined); return true; }
      }
    }
  }

  // 2b. No session — does this message trigger a flow? (Flows fire only on their
  // platform and number-scope; the match + start lives in triggerByKeyword.)
  return (await triggerByKeyword(text, convKey, phone, send, isReal, opts, tid)) ?? false;
}

// ── No-reply reminders (called from the cron) ─────────────────────────────────
// Waiting blocks (buttons/list/ask) can set a STAGED chain of reminders: if the
// customer hasn't answered, nudge after the first delay, then again after each
// later delay (each measured from the PREVIOUS nudge). Replying or moving to a
// new node resets the chain (fresh session state). Legacy single-reminder configs
// (reminderMinutes + reminderText) are read as a one-step chain.
function reminderSteps(data: Record<string, unknown> | undefined): { minutes: number; text: string }[] {
  if (!data) return [];
  const raw = data.reminders;
  if (Array.isArray(raw)) {
    return raw
      .map(r => ({ minutes: Math.max(0, Number((r as { minutes?: unknown })?.minutes ?? 0)), text: str((r as { text?: unknown })?.text) }))
      .filter(r => r.minutes > 0 && !!r.text.trim());
  }
  const mins = Number(data.reminderMinutes ?? 0);
  const text = str(data.reminderText);
  return mins > 0 && text.trim() ? [{ minutes: mins, text }] : [];
}

export async function drainFlowReminders(max = 50): Promise<number> {
  const { data } = await db().from("wa_flow_sessions").select("*").limit(500);
  let sent = 0;
  const flowCache = new Map<string, Flow | null>();
  for (const s of data ?? []) {
    if (sent >= max) break;
    const convKey = s.conversation_id as string;
    if (convKey.startsWith("sim:")) continue;                       // simulator sessions
    const state = ((s.state as Record<string, unknown>) ?? {});

    const sTid = (s.tenant_id as string) ?? DEFAULT_TENANT_ID;
    if (!flowCache.has(s.flow_id as string)) flowCache.set(s.flow_id as string, await getFlow(s.flow_id as string, sTid));
    const flow = flowCache.get(s.flow_id as string);
    if (!flow?.active) continue;
    const node = nodeById(flow.graph, s.current_node as string);
    const reminders = reminderSteps(node?.data as Record<string, unknown> | undefined);
    if (!node || !reminders.length) continue;

    // Which nudge is next? Legacy boolean `reminded` counts as one already sent.
    const sentCount = Number(state.remindersSent ?? (state.reminded ? 1 : 0));
    if (sentCount >= reminders.length) continue;                    // whole chain delivered
    const step = reminders[sentCount];
    // Each delay is measured from the previous send: updated_at re-stamps on every
    // nudge (and on node entry), so the chain fires step-by-step, not all at once.
    if (Date.now() - new Date(s.updated_at as string).getTime() < step.minutes * 60_000) continue;

    // Meta compliance: free-form sends only inside the 24h customer window.
    const { data: conv } = await db().from("wa_conversations").select("*").eq("id", convKey).maybeSingle();
    if (!conv?.phone || !conv.last_inbound_at) continue;
    if (Date.now() - new Date(conv.last_inbound_at as string).getTime() > 23.5 * 3600_000) continue;

    // Stop-on-reply, incl. OFF-SCRIPT free-text the AI answers WITHOUT advancing the
    // flow (e.g. the lead asks a question instead of tapping a button): if any inbound
    // landed after we entered this node or sent the last nudge, the lead is engaged —
    // don't nudge "you haven't replied". updated_at re-stamps on node entry and on
    // every send, so last_inbound_at > updated_at means "replied since we last acted".
    if (new Date(conv.last_inbound_at as string) > new Date(s.updated_at as string)) continue;

    // Atomic claim BEFORE sending — compare-and-swap on the exact updated_at we read.
    // Only the cron tick that still sees this timestamp wins, so overlapping ticks
    // (the 1-min pinger + GitHub */5) can't double-send the same nudge. A customer
    // reply advances the session (new updated_at), so the CAS also fails then and the
    // stale nudge is suppressed — stop-on-reply for free. The claim re-stamps
    // updated_at, arming the timer for the next step in the chain.
    const nextState = { ...state, remindersSent: sentCount + 1 };
    delete (nextState as Record<string, unknown>).reminded;          // drop legacy flag
    const claimed = await db().from("wa_flow_sessions")
      .update({ state: nextState, updated_at: new Date().toISOString() })
      .eq("conversation_id", convKey).eq("updated_at", s.updated_at as string)
      .select("conversation_id");
    if (!claimed.data?.length) continue;                            // another tick won / customer replied

    // Reply from the same number the chat lives on.
    const channel = conv.channel_id ? (await getChannel(conv.channel_id as string)) ?? undefined : undefined;
    const r = await realSender(convKey, conv.phone as string, channel, (conv.tenant_id as string) ?? sTid).text(step.text);
    if (!r.error) sent++;
  }
  return sent;
}
