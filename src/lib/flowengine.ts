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
  sendText, sendButtons, sendList, sendMedia, sendProduct, sendProductList, sendCtaUrl, sendCarouselTemplate, sendTemplateSingle, fetchTemplates,
} from "./whatsapp";
import { sendWaFormMessage, getWaFormDef, fieldSlug } from "./waforms";
import { sendIgMessage, sendIgQuickReplies } from "./instagram";
import { sendFbMessage, sendFbMedia, sendFbQuickReplies } from "./messenger";
import { getChannel, type Channel, type ChannelCreds } from "./channels";
import {
  appendConvMessage, touchOutbound, setConversationStatus,
  setContactAttributes, getContactByPhone, claimReply, setConversationAgent, setConversationKbTag,
  addContactTag, takeArmedFlow, updateContactProfile, setConversationName, setConversationLeadPhone, upsertContacts,
  landCapturedLead, formLinkForWaba,
} from "./store";
import { recordFormSent, recordFormSubmitted, markFormAbandoned } from "./formresponses";
import { isAiEnabled, getFlowNudge } from "./messaging-settings";
import { syncLeadProfile } from "./leadsquared";
import { looksLikeCity } from "./llm";
import { getProduct } from "./commerce";
import { calcomSlots, calcomBook, matchSlot, extractEmail } from "./integrations";
import { safeFetch } from "./ssrf";


// Options whose label reads like a human-handoff request — used to auto-escalate
// when such a button is left unconnected in the builder (instead of dead-ending).
const AGENT_OPT_RE = /\b(agent|human|representative|support|person|talk to|speak to|connect)\b/i;

// The contact tag a captured lead gets for the channel it talked on.
const channelTag = (kind?: string) =>
  kind === "webchat" ? "web-chat" : kind === "instagram" ? "instagram" : kind === "messenger" ? "messenger" : "whatsapp";

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface FlowEdge { id: string; source: string; sourceHandle?: string | null; target: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }
// A flow's platform is stored as the channel kind(s) it runs on. A multi-channel
// flow stores a comma-separated SET, e.g. "whatsapp,messenger,webchat". Legacy
// single values and keywords still resolve: "all" = every kind, "both" = WhatsApp
// + Instagram. (Free text — the app validates; the DB check was dropped in 0065.)
export type FlowPlatform = string;
export const FLOW_PLATFORM_KINDS = ["whatsapp", "instagram", "messenger", "webchat"] as const;

// Expand a stored platform value into the set of channel kinds it runs on.
export function platformKinds(value: string | null | undefined): Set<string> {
  const v = (value ?? "").trim();
  if (!v) return new Set(["whatsapp"]);     // historic default — NOT every channel
  if (v === "all") return new Set(FLOW_PLATFORM_KINDS);
  if (v === "both") return new Set(["whatsapp", "instagram"]);
  return new Set(v.split(",").map(s => s.trim()).filter(Boolean));
}

// Does a flow that targets `target` run on a channel of kind `kind`?
export function flowRunsOn(target: string, kind: string): boolean {
  return platformKinds(target).has(kind);
}

export interface Flow {
  id: string; name: string; active: boolean; triggerKeywords: string[];
  platform: FlowPlatform;       // which channel kind(s) this flow runs on
  channelId: string | null;     // legacy single-channel scope (kept in sync with channelIds; null = unscoped)
  channelIds: string[];         // scope to these specific numbers/accounts (empty = every channel of that platform)
  primaryKbTag: string | null;  // AI in this flow answers from KB docs with this tag first
  graph: FlowGraph; createdAt: string; updatedAt: string;
}

// A flow runs on a given channel when it's unscoped (no channelIds → every
// channel of its platform) or that channel is in its set. No channel context
// (the simulator passes none) always matches so test runs aren't excluded.
export function flowAllowsChannel(flow: Pick<Flow, "channelIds" | "channelId">, channel?: { id: string } | null): boolean {
  if (!channel) return true;
  const ids = flow.channelIds.length ? flow.channelIds : (flow.channelId ? [flow.channelId] : []);
  return ids.length === 0 || ids.includes(channel.id);
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
    channelIds: (r.channel_ids as string[] | null) ?? ((r.channel_id as string | null) ? [r.channel_id as string] : []),
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

export async function updateFlow(id: string, p: Partial<{ name: string; active: boolean; triggerKeywords: string[]; platform: FlowPlatform; channelId: string | null; channelIds: string[]; primaryKbTag: string | null; graph: FlowGraph }>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) patch.name = p.name;
  if (p.active !== undefined) patch.active = p.active;
  if (p.triggerKeywords !== undefined) patch.trigger_keywords = p.triggerKeywords.map(k => norm(k)).filter(Boolean);
  if (p.platform !== undefined) patch.platform = p.platform;
  // channelIds is the source of truth; keep the legacy single channel_id in sync
  // (one selection → that id, otherwise null) so any old reader still behaves.
  if (p.channelIds !== undefined) {
    patch.channel_ids = p.channelIds.length ? p.channelIds : null;
    patch.channel_id = p.channelIds.length === 1 ? p.channelIds[0] : null;
  } else if (p.channelId !== undefined) {
    patch.channel_id = p.channelId;
    patch.channel_ids = p.channelId ? [p.channelId] : null;
  }
  if (p.primaryKbTag !== undefined) patch.primary_kb_tag = p.primaryKbTag || null;
  if (p.graph !== undefined) patch.graph = p.graph;
  let { error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id);
  // channel_ids is the newest optional column (0072). If it's missing, retry
  // WITHOUT it but KEEP the legacy channel_id (which predates 0072 and still
  // carries single-channel scope) plus platform/primary_kb_tag — so scoping a
  // flow to one number keeps working before the migration is applied. Only a
  // MULTI-number selection genuinely needs 0072; say so loudly.
  if (error && "channel_ids" in patch) {
    const triedMultiChannel = Array.isArray(patch.channel_ids) && patch.channel_ids.length > 1;
    delete patch.channel_ids;
    ({ error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id));
    if (!error && triedMultiChannel) throw new Error("Running a flow on multiple specific numbers needs migration 0072_flow_channels.sql applied, then save again.");
  }
  // Older optional columns missing (much older DB) — save the rest, but never
  // let an Instagram flow silently persist as WhatsApp-only: without the column
  // it would read back as "whatsapp" and never trigger on IG. Fail loudly.
  if (error && ("channel_id" in patch || "platform" in patch || "primary_kb_tag" in patch)) {
    const triedPlatform = typeof patch.platform === "string" && patch.platform !== "whatsapp";
    delete patch.channel_id; delete patch.platform; delete patch.primary_kb_tag;
    ({ error } = await db().from("wa_flows").update(patch).eq("tenant_id", tenantId).eq("id", id));
    if (!error && triedPlatform) throw new Error("This flow's platform setting needs the wa_flows.platform migrations applied (0023 + 0046 + 0062 + 0064 + 0065_flow_platform_multi.sql), then save again.");
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
  // Which channel this sender talks to — lets nodes that only exist on one
  // platform (e.g. a native WhatsApp form) degrade properly elsewhere.
  kind?: "whatsapp" | "instagram" | "messenger" | "webchat" | "dry";
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

// Cross-WABA template fallback. An approved WhatsApp template belongs to the WABA
// it was created on; a number on a DIFFERENT WABA can't send it and Meta rejects
// it. Read the template's BODY copy from its home WABA (default creds), fill {{n}}
// with the flow's params, and return it so the flow can send it as plain text
// (flows run in-window, so free-form text delivers). null when it can't be read.
async function templateBodyFallback(name: string, lang: string, params: string[]): Promise<string | null> {
  try {
    const tpls = await fetchTemplates();   // default (home-WABA) creds
    const norm2 = (s: string) => (s || "").toLowerCase().replace(/[_-]/g, "");
    const tpl = tpls.find(t => t.name === name && norm2(t.language) === norm2(lang)) ?? tpls.find(t => t.name === name);
    const body = tpl?.components?.find(c => c.type === "BODY")?.text;
    if (!body) return null;
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? "").trim() || null;
  } catch { return null; }
}

// Degrade a rejected (cross-WABA) template to plain text: its body copy plus the
// header / first-card image (public URLs — not WABA-scoped). No-op + warn if the
// body can't be read.
async function templateFallbackSend(send: FlowSender, name: string, lang: string, params: string[], imageUrl?: string): Promise<void> {
  const text = await templateBodyFallback(name, lang, params);
  if (!text) { console.warn(`[flow] template ${name} send failed cross-WABA and body unreadable — skipping node`); return; }
  if (imageUrl) await send.media("image", imageUrl).catch(() => undefined);
  await send.text(text);
}

function realSender(conversationId: string, phone: string, channel?: ChannelCreds, tenantId = DEFAULT_TENANT_ID): FlowSender {
  // Full Channel rows carry an id (per-message channel log, 0073); bare env
  // creds don't — the log column just stays null then.
  const channelId = (channel as { id?: string } | undefined)?.id ?? null;
  const log = async (body: string, metaId?: string) => {
    if (!metaId) return;
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId, channelId }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  return {
    kind: "whatsapp",
    async text(body) { const r = await sendText(phone, body, channel); await log(body, r.id); return r; },
    async buttons(body, buttons) { const r = await sendButtons(phone, body, buttons, channel); await log(`${body}\n[buttons: ${buttons.map(b => b.title).join(" | ")}]`, r.id); return r; },
    async list(body, buttonText, sections) { const r = await sendList(phone, body, buttonText, sections, channel); await log(`${body}\n[list: ${sections.flatMap(s => s.rows.map(x => x.title)).join(" | ")}]`, r.id); return r; },
    async media(kind, url, caption) { const r = await sendMedia(phone, kind, url, caption, channel); await log(`[${kind}] ${caption ?? url}`, r.id); return r; },
    async product(body, catalogId, productId) { const r = await sendProduct(phone, body, catalogId, productId, channel); await log(`[product ${productId}] ${body}`, r.id); return r; },
    async productCard(body, imageUrl, buttonText, buttonUrl) { const r = await sendCtaUrl(phone, body, buttonText, buttonUrl, channel, imageUrl ?? undefined); await log(`[product card] ${body}\n[${buttonText}] ${buttonUrl}`, r.id); return r; },
    async productList(header, body, catalogId, sections) { const r = await sendProductList(phone, header, body, catalogId, sections, channel); await log(`${body}\n[catalog: ${sections.flatMap(s => s.productRetailerIds).length} products]`, r.id); return r; },
    async template(templateName, lang, bodyParams, headerImageUrl) { const r = await sendTemplateSingle(phone, templateName, lang, bodyParams, channel, headerImageUrl); await log(`[template: ${templateName}${bodyParams.length ? ` · ${bodyParams.join(", ")}` : ""}]`, r.id); return r; },
    async carouselTemplate(templateName, lang, bubbleParams, cards) { const r = await sendCarouselTemplate(phone, templateName, lang, bubbleParams, cards, channel); await log(`[carousel template: ${templateName} · ${cards.length} cards]`, r.id); return r; },
    async waform(body, cta, formId) {
      // A form lives on one WABA. If this number is on another WABA, send the
      // copy replicated there via "Publish to all numbers" (wa_form_links); with
      // no copy (or single-number mode) the original id is used, and a rejection
      // still falls back to chat Q&A in the node handler.
      const targetWaba = channel?.wabaId;
      const resolvedId = targetWaba ? ((await formLinkForWaba(formId, targetWaba, tenantId).catch(() => null)) ?? formId) : formId;
      const r = await sendWaFormMessage(phone, { formId: resolvedId, bodyText: body, cta }, channel);
      await log(`${body}\n[form: ${cta}]`, r.id);
      return r;
    },
  };
}

// Instagram sender — menu options render as tappable QUICK REPLIES (up to 13,
// titles ≤20 chars). If the options don't fit that (too many / too long), we
// fall back to a numbered text menu. Either way matchOption resolves the tap or
// the typed number. Sends respect the 24h window (the flow runs right after the
// inbound, so it's open).

// A Meta quick-reply title is capped at 20 chars. Truncate a longer label for
// DISPLAY only — the tap carries the option's payload/id, so matchOption still
// resolves the choice. This keeps tappable buttons instead of dropping a
// long-labelled menu to a plain numbered list.
function clipTitle(t: string): string {
  const s = (t || "").trim();
  return s.length > 20 ? s.slice(0, 19).trimEnd() + "…" : s;
}
function igSender(conversationId: string, phone: string, channel: Channel, tenantId = DEFAULT_TENANT_ID): FlowSender {
  const creds = { igUserId: channel.igUserId ?? "", token: channel.token };
  const log = async (body: string, metaId?: string) => {
    if (!metaId) return;
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId, channelId: channel.id }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  const sendIg = async (body: string): Promise<{ id?: string; error?: string }> => {
    const r = await sendIgMessage(creds, phone, body, { lastInboundAt: new Date().toISOString() });
    await log(body, r.messageId);
    return { id: r.messageId, error: r.error };
  };
  const numberedMenu = (body: string, opts: string[]) => sendIg(opts.length ? `${body}\n\n${opts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : body);
  // Tappable chips. Long labels are truncated for display (not dropped to text),
  // so the menu still gets buttons; only >13 options (IG's max) or an API rejection
  // falls back to a numbered text menu.
  const chips = async (body: string, options: { id: string; title: string }[]): Promise<{ id?: string; error?: string }> => {
    if (options.length === 0) return sendIg(body);
    if (options.length > 13) return numberedMenu(body, options.map(o => o.title));
    const r = await sendIgQuickReplies(creds, phone, body, options.map(o => ({ title: clipTitle(o.title), payload: o.id })), { lastInboundAt: new Date().toISOString() });
    if (!r.ok) return numberedMenu(body, options.map(o => o.title));   // fallback if rejected
    await log(`${body}\n[options: ${options.map(o => o.title).join(" | ")}]`, r.messageId);
    return { id: r.messageId };
  };
  return {
    kind: "instagram",
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
    await appendConvMessage({ conversationId, role: "assistant", body, metaId, source: "bot", tenantId, channelId: channel.id }).catch(() => undefined);
    await touchOutbound(conversationId, body).catch(() => undefined);
  };
  const sendFb = async (body: string): Promise<{ id?: string; error?: string }> => {
    const r = await sendFbMessage(creds, phone, body, { lastInboundAt: now() });
    await log(body, r.messageId);
    return { id: r.messageId, error: r.error };
  };
  const numberedMenu = (body: string, opts: string[]) => sendFb(opts.length ? `${body}\n\n${opts.map((t, i) => `${i + 1}. ${t}`).join("\n")}` : body);
  // Long labels are truncated for display (not dropped to text); only >13 options
  // (Messenger's max) or an API rejection falls back to a numbered text menu.
  const chips = async (body: string, options: { id: string; title: string }[]): Promise<{ id?: string; error?: string }> => {
    if (options.length === 0) return sendFb(body);
    if (options.length > 13) return numberedMenu(body, options.map(o => o.title));
    const r = await sendFbQuickReplies(creds, phone, body, options.map(o => ({ title: clipTitle(o.title), payload: o.id })), { lastInboundAt: now() });
    if (!r.ok) return numberedMenu(body, options.map(o => o.title));   // fallback if rejected
    await log(`${body}\n[options: ${options.map(o => o.title).join(" | ")}]`, r.messageId);
    return { id: r.messageId };
  };
  return {
    kind: "messenger",
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
    kind: "dry",
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
  // A brand-new caller with no contact row still gets tokens stripped — an empty
  // substitution beats greeting them with a literal "{{name}}".
  if (!text || !text.includes("{{")) return text;
  const cv = c ?? {};
  const attrs = cv.attributes ?? {};
  // Collected-attribute lookup, case-insensitive. Reserved tokens fall back to
  // it when the profile column is empty — an ask node saving attribute "email"
  // writes only to attributes, and {{email}} must still render what was asked.
  const attr = (k: string) => { const hit = Object.keys(attrs).find(x => x.toLowerCase() === k); return hit ? String(attrs[hit] ?? "") : ""; };
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, raw: string) => {
    const key = raw.trim().toLowerCase();
    if (key === "name" || key === "firstname" || key === "first_name") return (cv.name || attr("name")).trim().split(/\s+/)[0] || "";
    if (key === "fullname" || key === "full_name") return (cv.name || attr("name")).trim();
    if (key === "phone" || key === "mobile") return cv.phone || attr("phone") || attr("mobile");
    if (key === "email") return (cv.email || attr("email")).trim();
    return attr(key);
  });
}
// Wrap a sender so every customer-facing TEXT/body/caption is variable-filled.
// Option/row TITLES are left literal — option-matching reads them from node data,
// so a filled title could break the tap resolution.
function withVars(send: FlowSender, c: ContactVars | null): FlowSender {
  const f = (s: string) => fillVars(s, c);
  return {
    kind: send.kind,   // keep the channel tag — platform degradations depend on it
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

// A reply to an `ask` step that reads like a question or greeting rather than an
// attempt to answer the field. When the user is clearly talking to us (not
// botching the field), we bail out of the flow and let the AI take over instead
// of nagging — a visitor typing "how are you" must never be stuck on "that's not
// a valid email". Only consulted when the answer already FAILED validation.
export function looksConversational(text: string): boolean {
  if ((text || "").includes("?")) return true;
  const s = norm(text);
  if (!s) return false;
  return /^(hi|hii+|hey+|hello+|yo|hola|namaste|thanks|thank you|thx|ok|okay|cool|great|good (morning|afternoon|evening)|sup)\b/.test(s)
    || /^(how|what|whats|why|who|whom|whose|when|where|which|can|could|would|will|shall|should|do|does|did|is|are|am|may|might|tell me|explain|help|i (want|need|have|am)|please|you there|u there)\b/.test(s);
}

// A rough "does this read like a person's name" gate for name-attribute answers
// (ask nodes and chat-form fields). Names are short; a long or clearly
// conversational reply means the person is talking about something else
// entirely (an unrelated inquiry, a refusal, small talk) — not answering
// "what's your name?" — and must not be stored as if it were one.
function looksLikeName(text: string): boolean {
  const t = (text || "").trim();
  return t.length > 0 && t.length <= 60 && !looksConversational(t);
}

// ── WhatsApp-form fallback for chat-only channels ─────────────────────────────
// A native WhatsApp form can't open on Instagram / Messenger / web chat. Instead
// of dead-ending the flow there (the old behavior sent "body (CTA)" and then
// waited forever for a submission that can only come from WhatsApp), the form's
// fields are collected as a chat Q&A: one question per message, answers saved to
// the SAME contact attributes a real form submission would write.
export interface ChatFormField { n: string; l: string; t: string; o: string[] }

// The question bubble for one field. Options render as a numbered menu the user
// answers by number or by typing the option. Exported for unit tests — pure.
export function chatFieldPrompt(f: ChatFormField): string {
  if (f.o.length) return `${f.l}\n${f.o.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  if (f.t === "optin") return `${f.l} (yes/no)`;
  return /[?:]\s*$/.test(f.l) ? f.l : `${f.l}?`;
}

// Sends nodes starting at `node` until the flow waits for input or ends.
// `menuNodeId`: the interactive node this run branched from — when the branch
// dead-ends (no outgoing edge, no explicit End node), the session returns
// there so the user can still pick the other menu options.
// Returns true if the conversation is now (or was) inside the flow.
async function runFrom(flow: Flow, node: FlowNode | undefined, convKey: string, phone: string, baseSend: FlowSender, isReal: boolean, menuNodeId?: string | null, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const g = flow.graph;
  let steps = 0;
  let cur = node;
  // Track whether this run actually emitted anything to the user. A run that
  // walks into a dead-ended branch (e.g. an unconnected condition/ask edge, or an
  // answered ask whose outgoing edge is missing) without sending must report "not
  // handled" so the channel falls through to the AI — otherwise IG/Messenger,
  // which have no AI fallback once a flow is "handled", strand the user in total
  // silence. Wrapping the sender covers every node's send sites in one place.
  let sent = false;
  const send: FlowSender = new Proxy(baseSend, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...a: unknown[]) => { sent = true; return (v as (...x: unknown[]) => unknown).apply(target, a); };
    },
  }) as FlowSender;
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
          const res = await send.product(str(d.text) || "Check this out:", str(d.catalogId), str(d.productId));
          // Cross-WABA: a commerce catalog belongs to one WABA, so a number on a
          // different WABA can't show the native product card. Send the node's
          // caption as plain text so it isn't silent (for a real cross-WABA product
          // card, use the custom-card style, or connect the catalog to this WABA).
          if (res.error && send.kind === "whatsapp" && str(d.text)) await send.text(str(d.text));
          else if (res.error && send.kind === "whatsapp") console.warn(`[flow] product ${str(d.productId)} send failed (${res.error}) — no caption to fall back to`);
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
          const lang = str(d.lang) || "en_US";
          const header = str(d.headerImageUrl).trim();
          if (cards.length >= 2) {
            const bubbleParams = str(d.bubbleParams).split(",").map(s => s.trim()).filter(Boolean);
            const res = await send.carouselTemplate(name, lang, bubbleParams, cards);
            if (res.error && send.kind === "whatsapp") await templateFallbackSend(send, name, lang, bubbleParams, cards[0]?.mediaUrl);
          } else {
            const params = ((d.bodyParams as string[]) ?? []).map(s => (s ?? "").trim());
            const res = await send.template(name, lang, params, header || undefined);
            if (res.error && send.kind === "whatsapp") await templateFallbackSend(send, name, lang, params, header || undefined);
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
          const res = await send.productList(header, str(d.text) || "Browse and tap to view:", catalogId, [{ title: header.slice(0, 24), productRetailerIds: ids }]);
          // Cross-WABA: the catalog isn't on this number's WABA. Send the header +
          // caption as plain text so the message isn't silently dropped.
          if (res.error && send.kind === "whatsapp") {
            const parts = [str(d.header).trim(), str(d.text).trim()].filter(Boolean);
            if (parts.length) await send.text(parts.join("\n"));
            else console.warn(`[flow] product list send failed (${res.error}) — nothing to fall back to`);
          }
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
          const lang = str(d.lang) || "en_US";
          const bubbleParams = str(d.bubbleParams).split(",").map(s => s.trim()).filter(Boolean);
          const res = await send.carouselTemplate(name, lang, bubbleParams, cards);
          if (res.error && send.kind === "whatsapp") await templateFallbackSend(send, name, lang, bubbleParams, cards[0]?.mediaUrl);
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
        // IG / Messenger / web chat can't open a WhatsApp form — collect the same
        // fields as a chat Q&A instead (one question per message; see the wf
        // resume branch in handleFlowMessage). If the form definition can't be
        // read, skip the node so the rest of the flow still runs.
        if (send.kind && send.kind !== "whatsapp" && send.kind !== "dry") {
          const def = await getWaFormDef(str(d.formId)).catch(() => null);
          const fields: ChatFormField[] = (def?.fields ?? [])
            .filter(f => f.label.trim())
            .map((f, i) => ({ n: fieldSlug(f.label, i), l: f.label.trim(), t: f.type, o: (f.options ?? []).filter(o => o.trim()).slice(0, 20) }));
          if (!fields.length) {
            console.warn(`[flow] waform ${str(d.formId)} unreadable on ${send.kind} — skipping the form node (${def?.error ?? "no fields"})`);
            cur = nextNode(g, cur.id); continue;
          }
          const intro = str(d.text) ? `${str(d.text)}\n\n` : "";
          await send.text(intro + chatFieldPrompt(fields[0]));
          if (isReal) await recordFormSent(convKey, phone, str(d.formId), tenantId).catch(() => undefined);
          await saveSession(convKey, flow.id, cur.id, { ...(menuNodeId ? { menu: menuNodeId } : {}), wf: { fields, i: 0, a: {} } }, tenantId);
          return true;
        }
        const formRes = await send.waform(str(d.text) || "Please fill this quick form:", str(d.cta) || "Open form", str(d.formId));
        // A WhatsApp Form (Flow) is a WABA-scoped Meta asset. If this number lives
        // on a DIFFERENT WABA than the form (e.g. numbers shared in via partner
        // access), Meta rejects the send — so instead of dying silently and
        // leaving the customer with nothing, fall back to collecting the same
        // fields as a chat Q&A, exactly like IG/Messenger/web do above. The form
        // definition is read with the default creds, so its fields are available
        // even from a number that isn't on the form's own WABA.
        if (formRes.error) {
          console.warn(`[flow] waform ${str(d.formId)} native send failed on whatsapp (${formRes.error}) — falling back to chat Q&A`);
          const def = await getWaFormDef(str(d.formId)).catch(() => null);
          const fields: ChatFormField[] = (def?.fields ?? [])
            .filter(f => f.label.trim())
            .map((f, i) => ({ n: fieldSlug(f.label, i), l: f.label.trim(), t: f.type, o: (f.options ?? []).filter(o => o.trim()).slice(0, 20) }));
          if (fields.length) {
            const intro = str(d.text) ? `${str(d.text)}\n\n` : "";
            await send.text(intro + chatFieldPrompt(fields[0]));
            if (isReal) await recordFormSent(convKey, phone, str(d.formId), tenantId).catch(() => undefined);
            await saveSession(convKey, flow.id, cur.id, { ...(menuNodeId ? { menu: menuNodeId } : {}), wf: { fields, i: 0, a: {} } }, tenantId);
            return true;
          }
          cur = nextNode(g, cur.id); continue;   // couldn't read fields either → skip the node so the rest runs
        }
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
  if (menuNodeId) { await saveSession(convKey, flow.id, menuNodeId, {}, tenantId); return true; }
  await endSession(convKey);
  // Nothing more to send and no menu to fall back to: report whether this run
  // emitted anything. If it sent (a flow that simply ended without an End node)
  // it's handled; if it sent nothing (a dead-ended branch) return false so the
  // channel's AI answers instead of leaving the user with silence.
  return sent;
}

// Squashed comparable form for typed menu picks: lowercase, "&" → "and", every
// non-alphanumeric dropped — so "Data Science and gen ai" equals "Data Science
// & GenAI" even though spacing/punctuation differ.
const squash = (s: string) => (s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");

// Resolve typed text to exactly ONE of `titles` by squash-equality or
// containment. Ambiguous (2+ hits) or too-short input returns null so the AI
// answers instead of guessing. Exported for unit tests — pure.
export function looseIndex(titles: string[], text: string): number | null {
  const tq = squash(text);
  if (tq.length < 4) return null;
  const hits: number[] = [];
  titles.forEach((title, i) => {
    const oq = squash(title);
    if (oq && (oq === tq || (oq.length >= 4 && (tq.includes(oq) || oq.includes(tq))))) hits.push(i);
  });
  return hits.length === 1 ? hits[0] : null;
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
  // Typed approximations — web/IG visitors TYPE the choice rather than tapping
  // ("Data Science and gen ai" for "Data Science & GenAI"). Accept only an
  // unambiguous squash-match; anything fuzzy-ambiguous falls through to the AI.
  const li = looseIndex(opts.map(o => o.title), text);
  if (li !== null) return opts[li].id;
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
      .filter(f => flowRunsOn(f.platform ?? "whatsapp", platform))
      .filter(f => flowAllowsChannel(f, opts.channel));
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

// A message the web-chat widget renders: text bubble + optional tappable quick-
// reply chips (from a flow's buttons/list) or an inline image/video. The flow runs
// synchronously inside the POST, so the route collects these and returns them
// inline; they're also persisted so a reload / the poll still shows the text.
export interface WebchatOut { id?: string; at?: string; body: string; options?: string[]; mediaUrl?: string; from: "bot" }

// Web-chat sender — mirrors igSender, but instead of a platform API it appends bot
// messages to the conversation AND pushes them into `out` for the route to return
// inline. Menu options become quick-reply chips; the persisted body also lists them
// as text so the inbox / a reloaded widget still shows the choices.
function webchatSender(conversationId: string, out: WebchatOut[], tenantId = DEFAULT_TENANT_ID): FlowSender {
  const push = async (cleanBody: string, options?: { id: string; title: string }[], mediaUrl?: string): Promise<{ id?: string; error?: string }> => {
    const persist = options && options.length ? cleanBody + "\n" + options.map(o => "• " + o.title).join("\n") : cleanBody;
    const saved = await appendConvMessage({ conversationId, role: "assistant", body: (persist || mediaUrl || "").slice(0, 4000), source: "bot", tenantId }).catch(() => null);
    await touchOutbound(conversationId, (persist || mediaUrl || "").slice(0, 200)).catch(() => undefined);
    out.push({ id: saved?.id, at: saved?.createdAt, body: cleanBody, options: options?.map(o => o.title), mediaUrl, from: "bot" });
    return { id: saved?.id ?? "wc" };
  };
  return {
    kind: "webchat",
    async text(body) { return push(body); },
    async buttons(body, buttons) { return push(body, buttons); },
    async list(body, _bt, sections) { return push(body, sections.flatMap(s => s.rows.map(r => ({ id: r.id, title: r.title })))); },
    async media(kind, url, caption) { return kind === "document" ? push(caption ? caption + "\n" + url : url) : push(caption ?? "", undefined, url); },
    async product(body) { return push(body); },
    async productCard(body, _img, buttonText, buttonUrl) { return push(body + "\n" + buttonText + ": " + buttonUrl); },
    async productList(header, body) { return push([header, body].filter(s => s && s.trim()).join("\n") || "Have a look:"); },
    async template(_n, _l, bodyParams) { return bodyParams.length ? push(bodyParams.join(" ")) : { id: "wc_noop" }; },
    async carouselTemplate(_n, _l, bubbleParams) { return bubbleParams.length ? push(bubbleParams.join(" ")) : { id: "wc_noop" }; },
    async waform(body, cta) { return push(body + "\n(" + cta + ")"); },
  };
}

export async function handleFlowMessage(
  convKey: string,
  phone: string,
  text: string,
  opts: { sender?: FlowSender; collector?: WebchatOut[]; onlyFlowId?: string; allowInactive?: boolean; channel?: Channel; adFlowId?: string; tenantId?: string } = {},
): Promise<boolean> {
  const tid = opts.tenantId ?? opts.channel?.tenantId ?? DEFAULT_TENANT_ID;
  const baseSend = opts.sender ?? (opts.channel?.kind === "instagram"
    ? igSender(convKey, phone, opts.channel, tid)
    : opts.channel?.kind === "messenger"
    ? fbSender(convKey, phone, opts.channel, tid)
    : opts.channel?.kind === "webchat"
    ? webchatSender(convKey, opts.collector ?? [], tid)
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

    // Off-script nudge: the person typed something the waiting step (a menu OR
    // an open WhatsApp form) can't use. When the AI isn't going to take the
    // message — switched off, or the text isn't really a question — reply with
    // a rotating Settings variation (max 3 per step) and KEEP the session
    // waiting, instead of the silence an AI-off setup used to get. Returns
    // true when a nudge was sent.
    const nudgeBack = async (): Promise<boolean> => {
      const aiOn = process.env.LLM_BOT_ENABLED !== "false" && (await isAiEnabled(tid).catch(() => true));
      if (aiOn && looksConversational(text)) return false;   // the AI answers real questions
      const nudge = await getFlowNudge(tid).catch(() => null);
      if (!nudge?.enabled || !nudge.variations.length) return false;
      const nudges = Number(session.state?.nudges ?? 0);
      if (nudges >= 3) {
        // Three nudges with no resolution — repeating a 4th, 5th, 6th… time reads
        // as a bot stuck in a loop (the exact complaint: the same 2-3 variations
        // cycling forever with the person's actual question never answered).
        // Hand off to a human instead: one final message, escalate so it surfaces
        // in Live Chat, and end the session so the NEXT message (from either
        // side) starts clean rather than re-entering this same dead end.
        // Send always (matching the regular nudge below — visible in the flow
        // builder's simulator too); only the DB side-effects need a real convo.
        await send.text("Connecting you with our team — someone will reply here shortly. 🙌");
        if (isReal) {
          await setConversationStatus(convKey, "escalated").catch(() => undefined);
          await claimReply(convKey).catch(() => undefined);
        }
        await endSession(convKey);
        return true;
      }
      await send.text(nudge.variations[nudges % nudge.variations.length]);
      await saveSession(convKey, flow.id, waiting.id, { ...(session.state ?? {}), nudges: nudges + 1 }, tid);
      if (isReal) await claimReply(convKey).catch(() => undefined);
      return true;
    };

    if (waiting.type === "ask") {
      const vtype = str(waiting.data.validate);
      const hasRule = !!vtype && vtype !== "none";
      const attr = str(waiting.data.attribute);
      // A name answer must also LOOK like a name — a long/conversational reply
      // ("i am not telling you", a whole paragraph) is someone talking, not a
      // name, and must never become the conversation's display name.
      const isNameAttr = /name/i.test(attr) && !/company|business|brand/i.test(attr);
      const valid = (!hasRule || (await validateInput(vtype, text, tid))) && (!isNameAttr || looksLikeName(text));
      // An old menu tap takes priority over a reply this ask can't use — but a
      // reply that passes the node's validation IS the answer. Rewinding first
      // hijacked digit answers to a number-validated ask ("2" travellers) as a
      // pick on the previous menu (matchOption maps any 1..N digit to an option),
      // so the answer could never be captured.
      if (!(hasRule && valid)) {
        const rewound = await rewind();
        if (rewound !== null) return rewound;
      }
      const tries = Number((session.state as Record<string, unknown>)?.tries ?? 0);
      if (!valid) {
        // The reply isn't a valid answer. If the user is clearly asking/chatting
        // rather than botching the field, or they've already missed twice, stop
        // nagging — end the flow and let the AI handle the conversation (don't
        // store the junk value, don't loop on "that's not a valid email").
        if (looksConversational(text) || tries >= 2) { await endSession(convKey); return false; }
        if (isReal) {
          await send.text(str(waiting.data.retryText) || "Hmm, that doesn't look right — could you share a valid answer?");
          await saveSession(convKey, flow.id, waiting.id, { ...(session.state ?? {}), tries: tries + 1 }, tid);
          await claimReply(convKey).catch(() => undefined);
        }
        return true;   // still waiting on this ask node
      }
      if (isReal && attr) {
        await setContactAttributes(phone, { [attr]: text.slice(0, 200) }, tid).catch(() => undefined);
        if (contact) contact.attributes = { ...(contact.attributes ?? {}), [attr]: text.slice(0, 200) };  // live for {{attr}} this run
        // Promote a captured email onto the contact profile too (the chat-form
        // path already does) so the Contacts list shows it, not just attributes.
        if (/email/i.test(attr) && /^\S+@\S+\.\S+$/.test(text.trim())) {
          await updateContactProfile(phone, { email: text.trim() }, tid).catch(() => undefined);
        }
        // Land identity on the conversation too: a name answer replaces the
        // "Website visitor" placeholder; a phone answer becomes the CRM match key.
        if (/name/i.test(attr) && !/company|business|brand/i.test(attr)) {
          await setConversationName(phone, text.trim().slice(0, 120), tid).catch(() => undefined);
          // Re-land: if their number is already captured (or IS the WhatsApp
          // key), the freshly-learned name fills the contact too.
          await landCapturedLead(phone, (send.kind ?? "whatsapp") === "whatsapp" ? phone : null, channelTag(send.kind), tid);
        }
        if (/phone|mobile|whats?app/i.test(attr)) {
          const d = text.replace(/\D/g, "");
          if (d.length >= 10 && d.length <= 15) {
            await setConversationLeadPhone(convKey, d).catch(() => undefined);
            await landCapturedLead(phone, d, channelTag(send.kind), tid);   // into Contacts / merge a returning lead
          }
        }
        // Mirror a CRM-relevant capture (email / city) onto the LSQ lead. Without
        // this, the flow-collected email never reached the CRM. Real phone only,
        // so web-chat/IG synthetic conversation ids never create junk leads.
        if (/email|city/i.test(attr) && phone.replace(/\D/g, "").length >= 10) {
          const a = contact?.attributes ?? {};
          const pick = (re: RegExp) => { for (const [k, v] of Object.entries(a)) if (re.test(k) && String(v).trim()) return String(v).trim(); return undefined; };
          void syncLeadProfile({ phone, email: pick(/email/i), city: pick(/city/i), name: contact?.name ?? undefined }, tid);
        }
      }
      const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
      if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
      return consumed;
    }

    if (waiting.type === "waform") {
      // Chat-native collection in progress (IG/Messenger/web chat — the native
      // form can't open there, so fields are asked one message at a time).
      const wf = session.state?.wf as { fields: ChatFormField[]; i: number; a: Record<string, string> } | undefined;
      if (wf && Array.isArray(wf.fields) && wf.fields[wf.i]) {
        const rewound = await rewind();
        if (rewound !== null) return rewound;
        const f = wf.fields[wf.i];
        // Land whatever identity we can infer from the fields answered SO FAR
        // onto the conversation, a real contact, and LeadSquared. Shared by a
        // genuine completion (below) AND an early exit (also below) — a name
        // typed on field 1 must not be silently lost just because the person
        // later bails on field 2 ("i am not providing you phone number" reads
        // as chit-chat to looksConversational and used to end the whole
        // session, taking the already-answered name down with it).
        const landIdentity = async (ans: Record<string, string>): Promise<void> => {
          const pick = (re: RegExp) => { for (const [k, v] of Object.entries(ans)) if (re.test(k) && String(v).trim()) return String(v).trim(); return undefined; };
          const nameKey = Object.keys(ans).find(k => /name/i.test(k) && !/company|business|brand/i.test(k) && String(ans[k]).trim());
          const name = nameKey ? String(ans[nameKey]).trim().slice(0, 120) : undefined;
          const email = pick(/email/i);
          const city = pick(/city/i);
          const phoneDigits = (pick(/phone|mobile|whats?app|contact/i) ?? "").replace(/\D/g, "");
          const phoneAns = phoneDigits.length >= 10 && phoneDigits.length <= 15 ? phoneDigits : undefined;
          if (name) await setConversationName(phone, name, tid).catch(() => undefined);
          if (phoneAns) await setConversationLeadPhone(convKey, phoneAns).catch(() => undefined);
          const realPhone = phoneAns ?? ((send.kind ?? "whatsapp") === "whatsapp" && phone.replace(/\D/g, "").length >= 10 ? phone.replace(/\D/g, "") : undefined);
          if (realPhone) {
            await upsertContacts([{ phone: realPhone, name, email, tags: ["chat-form", channelTag(send.kind)] }], "chat_form", tid).catch(() => undefined);
            await updateContactProfile(realPhone, { ...(name ? { name } : {}), ...(email ? { email } : {}) }, tid).catch(() => undefined);
            await setContactAttributes(realPhone, ans, tid).catch(() => undefined);
            void syncLeadProfile({ phone: realPhone, email, city, name }, tid);
          }
        };
        // Resolve option menus by number or typed label; validate typed fields
        // exactly like an ask node (2 retries, conversational bail-out to the AI).
        let answer = text.trim().slice(0, 200);
        if (f.o.length) {
          const t = norm(text);
          const n = /^\d{1,2}$/.test(t) ? parseInt(t, 10) : 0;
          if (n >= 1 && n <= f.o.length) answer = f.o[n - 1];
          else {
            const li = looseIndex(f.o, text);   // typed approximations too
            answer = f.o.find(o => norm(o) === t) ?? (li !== null ? f.o[li] : answer);
          }
        } else if (
          (["email", "phone", "number"].includes(f.t) && !(await validateInput(f.t, text, tid)))
          || (/name/i.test(f.n) && !/company|business|brand/i.test(f.n) && !looksLikeName(text))
        ) {
          const tries = Number(session.state?.tries ?? 0);
          if (looksConversational(text) || tries >= 2) {
            if (isReal) { await landIdentity(wf.a ?? {}); await markFormAbandoned(convKey, tid).catch(() => undefined); }
            await endSession(convKey);
            return false;
          }
          await send.text("Hmm, that doesn't look right — could you share a valid answer?");
          await saveSession(convKey, flow.id, waiting.id, { ...(session.state ?? {}), tries: tries + 1 }, tid);
          if (isReal) await claimReply(convKey).catch(() => undefined);
          return true;   // still waiting on this field
        }
        const answers = { ...(wf.a ?? {}), [f.n]: answer };
        if (isReal) {
          await setContactAttributes(phone, { [f.n]: answer }, tid).catch(() => undefined);
          if (contact) contact.attributes = { ...(contact.attributes ?? {}), [f.n]: answer };  // live for {{attr}} this run
        }
        if (wf.fields[wf.i + 1]) {
          await send.text(chatFieldPrompt(wf.fields[wf.i + 1]));
          await saveSession(convKey, flow.id, waiting.id, { ...(session.state ?? {}), wf: { ...wf, i: wf.i + 1, a: answers }, tries: 0 }, tid);
          if (isReal) await claimReply(convKey).catch(() => undefined);
          return true;
        }
        // Every field collected — land the identity everywhere, same as a real
        // submission: the conversation (display name + CRM phone), a REAL
        // contact (web/IG visitors have none — setContactAttributes no-ops for
        // them), the Responses view, and LeadSquared.
        if (isReal) {
          await recordFormSubmitted(convKey, phone, answers, tid).catch(() => undefined);
          await landIdentity(answers);
        }
        const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
        if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
        return consumed;
      }
      // Continue only on the form submission (webhook renders it as "[form] …").
      if (text.startsWith("[form]")) {
        const consumed = await runFrom(flow, nextNode(flow.graph, waiting.id), convKey, phone, send, isReal, undefined, tid);
        if (isReal && consumed) await claimReply(convKey).catch(() => undefined);
        return consumed;
      }
      // Old menu tap → rewind. Off-script text while the native form is open →
      // nudge them back to it (the "Get Started" CTA) BEFORE giving up — this
      // was the production silence: "What course you offer??" under a form CTA
      // marked the form abandoned and returned to an AI that was switched off.
      // nudgeBack handles BOTH the nudge and, once exhausted, the hand-off to a
      // human — the old mark-abandoned-and-let-the-AI-answer path below only
      // runs when the nudge is switched off entirely, or the AI will genuinely
      // answer a real question.
      const rewound = await rewind();
      if (rewound !== null) return rewound;
      const restartedWf = await triggerByKeyword(text, convKey, phone, send, isReal, opts, tid);
      if (restartedWf !== null) return restartedWf;
      if (await nudgeBack()) return true;
      if (isReal && await markFormAbandoned(convKey, tid)) {
        await appendConvMessage({ conversationId: convKey, role: "assistant", body: "[form-abandoned]", source: "bot", tenantId: tid }).catch(() => undefined);
      }
      // KEEP the session parked on the form (it TTLs out on its own). Ending it
      // here dropped a late submission on the floor: the person chatted past the
      // form, then tapped "Get Started" and submitted — but the "[form] …" reply
      // found no session and the flow never continued, forcing a full restart.
      // Restarts stay possible (trigger keywords above), old menus still rewind.
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
    // Genuinely off-script while a menu waits → the off-script nudge (see
    // nudgeBack above): the AI takes real questions when it's ON; everything
    // else — and everything when it's OFF — gets guided back to the menu.
    if ((waiting.type === "buttons" || waiting.type === "list") && (await nudgeBack())) return true;
    return false;
  }

  // 2a. No session, but the lead came from an ad bound to a flow → start it.
  // The CTWA referral only arrives on the first inbound, so this fires once,
  // and takes precedence over keywords (the first message is rarely a keyword).
  if (opts.adFlowId && !opts.onlyFlowId) {
    const flow = await getFlow(opts.adFlowId, tid);
    if (flow && (flow.active || opts.allowInactive) && flowAllowsChannel(flow, opts.channel)) {
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
      if (flow && flow.active && flowAllowsChannel(flow, opts.channel)) {
        await setConversationKbTag(convKey, flow.primaryKbTag).catch(() => undefined);
        const start = flow.graph.nodes.find(n => n.type === "start");
        const consumed = await runFrom(flow, start ? nextNode(flow.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
        if (consumed) { await claimReply(convKey).catch(() => undefined); return true; }
      }
    }
  }

  // 2b. No session — does this message trigger a flow? (Flows fire only on their
  // platform and number-scope; the match + start lives in triggerByKeyword.)
  const triggered = await triggerByKeyword(text, convKey, phone, send, isReal, opts, tid);
  if (triggered !== null) return triggered;

  // 2c. Nothing matched at all — no session, no keyword, no ad/armed flow. With
  // the AI switched OFF this used to be dead air ("anyone there?" → nothing).
  // Instead, open the DEFAULT flow — the active flow on this channel triggered
  // by "menu"/"hi"/"hello"/"start" — so the person lands in the guided menu;
  // from there the session + off-script nudges take over. Gated on the nudge
  // toggle (one switch owns the never-go-silent behaviour) and restricted to
  // flows that WAIT (menu/form/question): an immediately-ending flow would
  // re-fire on every message and could ping-pong with another bot forever.
  if (isReal) {
    const aiOn = process.env.LLM_BOT_ENABLED !== "false" && (await isAiEnabled(tid).catch(() => true));
    const nudgeCfg = aiOn ? null : await getFlowNudge(tid).catch(() => null);
    // FRESH/IDLE chats only — never hijack a conversation someone is already
    // handling: not when it's escalated (a human owns it — "our team will get
    // back to you" must not be followed by the bot re-opening the menu), and
    // not when anything went out in the last hour (mid-conversation remarks
    // aren't an invitation to restart).
    let freshChat = false;
    if (nudgeCfg?.enabled) {
      const { data: convRow } = await db().from("wa_conversations")
        .select("status, last_outbound_at").eq("id", convKey).maybeSingle();
      const lastOut = convRow?.last_outbound_at ? Date.parse(String(convRow.last_outbound_at)) : 0;
      freshChat = convRow?.status !== "escalated" && (!lastOut || Date.now() - lastOut > 60 * 60_000);
    }
    if (nudgeCfg?.enabled && freshChat) {
      const platform = opts.channel?.kind ?? "whatsapp";
      const DEFAULT_KW = ["menu", "hi", "hello", "start"];
      const def = (await listFlows(tid)).filter(f => f.active)
        .filter(f => flowRunsOn(f.platform ?? "whatsapp", platform))
        .filter(f => flowAllowsChannel(f, opts.channel))
        .filter(f => f.graph.nodes.some(n => ["buttons", "list", "waform", "ask"].includes(n.type)))
        .map(f => ({ f, rank: Math.min(...f.triggerKeywords.map(k => { const i = DEFAULT_KW.indexOf(norm(k)); return i === -1 ? 99 : i; }), 99) }))
        .filter(x => x.rank < 99)
        .sort((a, b) => a.rank - b.rank)[0]?.f;
      if (def) {
        await setConversationKbTag(convKey, def.primaryKbTag).catch(() => undefined);
        const start = def.graph.nodes.find(n => n.type === "start");
        const consumed = await runFrom(def, start ? nextNode(def.graph, start.id) : undefined, convKey, phone, send, isReal, undefined, tid);
        if (consumed) { await claimReply(convKey).catch(() => undefined); return true; }
      }
    }
  }
  return false;
}

// ── No-reply reminders (called from the cron) ─────────────────────────────────
// EVERY waiting block (buttons/list/ask/form) reminds a silent lead by default:
// once after 10 minutes, once more after a further hour — no builder config
// needed. A node's own STAGED chain overrides the default: nudge after the
// first delay, then again after each later delay (each measured from the
// PREVIOUS nudge). Replying or moving to a new node resets the chain (fresh
// session state). Legacy single-reminder configs (reminderMinutes +
// reminderText) are read as a one-step chain.
// Wording is deliberately neutral ("reply above", not "tap an option above") —
// this fires on EVERY waiting node type, including ask/waform steps that show
// no buttons at all, so it must read correctly whether the person is meant to
// tap, pick from a list, or just type an answer.
const DEFAULT_REMINDERS: { minutes: number; text: string }[] = [
  { minutes: 10, text: "Just checking in 👋 Whenever you're ready, reply above and we'll pick up right where we left off." },
  { minutes: 60, text: "We're still here to help! 🙂 Reply above to continue — or type \"menu\" to start over." },
];
function reminderSteps(data: Record<string, unknown> | undefined): { minutes: number; text: string }[] {
  const raw = data?.reminders;
  if (Array.isArray(raw)) {
    const chain = raw
      .map(r => ({ minutes: Math.max(0, Number((r as { minutes?: unknown })?.minutes ?? 0)), text: str((r as { text?: unknown })?.text) }))
      .filter(r => r.minutes > 0 && !!r.text.trim());
    if (chain.length) return chain;
  }
  const mins = Number(data?.reminderMinutes ?? 0);
  const text = str(data?.reminderText);
  if (mins > 0 && text.trim()) return [{ minutes: mins, text }];
  return DEFAULT_REMINDERS;
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

    // Reply on the SAME channel the chat lives on — reminders used to go
    // through the WhatsApp sender for every platform, so Instagram/Messenger/
    // web-chat sessions never actually received theirs.
    const channel = conv.channel_id ? (await getChannel(conv.channel_id as string)) ?? undefined : undefined;
    const cTid = (conv.tenant_id as string) ?? sTid;
    const kind = (conv.platform as string) || "whatsapp";
    let sender: FlowSender;
    if (kind === "instagram") { if (!channel) continue; sender = igSender(convKey, conv.phone as string, channel, cTid); }
    else if (kind === "messenger") { if (!channel) continue; sender = fbSender(convKey, conv.phone as string, channel, cTid); }
    else if (kind === "webchat") sender = webchatSender(convKey, [], cTid);   // appended to the conversation; the widget polls it up
    else sender = realSender(convKey, conv.phone as string, channel, cTid);
    const r = await sender.text(step.text);
    if (!r.error) sent++;
  }
  return sent;
}
