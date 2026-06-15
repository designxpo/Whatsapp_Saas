import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { encryptSecret, readSecret } from "./crypto";

// Default tenant — every pre-multitenant caller resolves to it, so existing
// call sites keep working while routes are retrofitted to pass a real tenantId.
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ── Types ────────────────────────────────────────────────────────────────────
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "partial" | "failed";
export type AutoTrigger = "contact_added" | "tag_added" | "api_event";

export interface Contact {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  tags: string[];
  attributes: Record<string, string>;
  status: "active" | "optedout";
  source: string | null;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string | null;
  templateName: string;
  languageCode: string;
  variables: string[];
  headerImageUrl: string | null;
  audience: { mode: "all" | "tag" | "recipients" | "attribute"; tag?: string; key?: string; value?: string } | null;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  errorSummary: string | null;
  scheduledFor: string | null;
  autoSendEnabled: boolean;
  autoSendTrigger: AutoTrigger | null;
  triggerKey: string | null;
  delayValue: number;
  delayUnit: "minutes" | "hours" | "days";
  createdAt: string;
  sentAt: string | null;
  channelId: string | null;     // which WhatsApp number this campaign sends from
  tenantId: string;             // owning tenant — sends use this tenant's channel/limits
}

const digits = (p: string) => (p || "").replace(/\D/g, "");
const last10 = (p: string) => digits(p).slice(-10);

function mapCampaign(r: Record<string, unknown>): Campaign {
  return {
    id: r.id as string,
    name: (r.name as string | null) ?? null,
    templateName: r.template_name as string,
    languageCode: r.language_code as string,
    variables: (r.variables as string[]) ?? [],
    headerImageUrl: (r.header_image_url as string | null) ?? null,
    audience: (r.audience as Campaign["audience"]) ?? null,
    status: r.status as CampaignStatus,
    totalRecipients: (r.total_recipients as number) ?? 0,
    sentCount: (r.sent_count as number) ?? 0,
    failedCount: (r.failed_count as number) ?? 0,
    errorSummary: (r.error_summary as string | null) ?? null,
    scheduledFor: (r.scheduled_for as string | null) ?? null,
    autoSendEnabled: (r.auto_send_enabled as boolean) ?? false,
    autoSendTrigger: (r.auto_send_trigger as AutoTrigger | null) ?? null,
    triggerKey: (r.trigger_key as string | null) ?? null,
    delayValue: (r.delay_value as number) ?? 0,
    delayUnit: (r.delay_unit as Campaign["delayUnit"]) ?? "minutes",
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string | null) ?? null,
    channelId: (r.channel_id as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
  };
}

function mapContact(r: Record<string, unknown>): Contact {
  return {
    id: r.id as string,
    phone: r.phone as string,
    name: (r.name as string) ?? "",
    email: (r.email as string | null) ?? null,
    tags: (r.tags as string[]) ?? [],
    attributes: (r.attributes as Record<string, string>) ?? {},
    status: r.status as Contact["status"],
    source: (r.source as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export async function upsertContacts(
  rows: { phone: string; name?: string; email?: string; tags?: string[]; attributes?: Record<string, string> }[],
  source = "import",
  tenantId = DEFAULT_TENANT_ID,
): Promise<{ inserted: number; skipped: number }> {
  const clean = rows
    .map(r => ({ tenant_id: tenantId, phone: digits(r.phone), name: (r.name ?? "").trim(), email: r.email?.trim() || null, tags: r.tags ?? [], attributes: r.attributes ?? {}, status: "active", source }))
    .filter(r => r.phone.length >= 10);
  if (clean.length === 0) return { inserted: 0, skipped: rows.length };
  const { data, error } = await db()
    .from("contacts")
    .upsert(clean, { onConflict: "tenant_id,phone", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  const inserted = data?.length ?? 0;
  return { inserted, skipped: rows.length - inserted };
}

export interface ContactAttrFilter { key: string; op: "is" | "is_not" | "contains"; value: string }

export async function listContacts(opts: {
  tag?: string | null; search?: string | null; limit?: number; offset?: number;
  createdFrom?: string | null; createdTo?: string | null;
  seenFrom?: string | null; seenTo?: string | null;     // last inbound message window
  attrs?: ContactAttrFilter[]; tenantId?: string;
} = {}): Promise<{ data: Contact[]; total: number }> {
  const tid = opts.tenantId ?? DEFAULT_TENANT_ID;
  let q = db().from("contacts").select("*", { count: "exact" }).eq("tenant_id", tid).order("created_at", { ascending: false });
  if (opts.tag) q = q.contains("tags", [opts.tag]);
  if (opts.search) q = q.or(`name.ilike.%${opts.search}%,phone.ilike.%${opts.search}%`);
  if (opts.createdFrom) q = q.gte("created_at", opts.createdFrom);
  if (opts.createdTo) q = q.lte("created_at", opts.createdTo);
  for (const a of opts.attrs ?? []) {
    const key = a.key.trim();
    if (!key) continue;
    if (a.op === "is") q = q.contains("attributes", { [key]: a.value });
    else if (a.op === "is_not") q = q.not("attributes", "cs", JSON.stringify({ [key]: a.value }));
    else q = q.ilike(`attributes->>${key}`, `%${a.value}%`);
  }
  // "Last seen" lives on conversations (last inbound message), so resolve the
  // matching phones first and narrow contacts to them.
  if (opts.seenFrom || opts.seenTo) {
    let cq = db().from("wa_conversations").select("phone").eq("tenant_id", tid).not("last_inbound_at", "is", null);
    if (opts.seenFrom) cq = cq.gte("last_inbound_at", opts.seenFrom);
    if (opts.seenTo) cq = cq.lte("last_inbound_at", opts.seenTo);
    const { data: convs } = await cq.limit(1000);
    const phones = [...new Set((convs ?? []).map(c => digits(c.phone as string)))];
    if (phones.length === 0) return { data: [], total: 0 };
    q = q.in("phone", phones);
  }
  const limit = Math.min(500, opts.limit ?? 100);
  q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { data: (data ?? []).map(mapContact), total: count ?? 0 };
}

// Recipients for a broadcast audience (active contacts only).
export async function recipientsForAudience(audience: { mode: "all" | "tag" | "attribute"; tag?: string; key?: string; value?: string }, tenantId = DEFAULT_TENANT_ID): Promise<{ phone: string; fullName: string }[]> {
  let q = db().from("contacts").select("phone, name").eq("tenant_id", tenantId).eq("status", "active");
  if (audience.mode === "tag" && audience.tag) q = q.contains("tags", [audience.tag]);
  if (audience.mode === "attribute" && audience.key) q = q.contains("attributes", { [audience.key]: audience.value ?? "" });
  const { data, error } = await q.limit(50000);
  if (error) throw error;
  return (data ?? []).map(r => ({ phone: r.phone as string, fullName: (r.name as string) ?? "" }));
}

// Add one tag to a contact (no-op when missing or already tagged).
export async function addContactTag(phone: string, tag: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const t = tag.trim();
  if (!t) return;
  const c = await getContactByPhone(phone, tenantId);
  if (!c || c.tags.includes(t)) return;
  await db().from("contacts").update({ tags: [...c.tags, t] }).eq("tenant_id", tenantId).eq("id", c.id);
}

// Merge attributes into an existing contact (does not overwrite unrelated keys).
export async function setContactAttributes(phone: string, attributes: Record<string, string>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const c = await getContactByPhone(phone, tenantId);
  if (!c) return;
  await db().from("contacts").update({ attributes: { ...c.attributes, ...attributes } }).eq("tenant_id", tenantId).eq("id", c.id);
}

// Partial profile edit from the contact drawer — only the provided fields change.
export async function updateContactProfile(phone: string, patch: { name?: string; email?: string | null; tags?: string[]; attributes?: Record<string, string> }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const c = await getContactByPhone(phone, tenantId);
  if (!c) return;
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.attributes !== undefined) row.attributes = patch.attributes;
  if (Object.keys(row).length) await db().from("contacts").update(row).eq("tenant_id", tenantId).eq("id", c.id);
}

export async function getContactByPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Contact | null> {
  const { data } = await db().from("contacts").select("*").eq("tenant_id", tenantId).eq("phone", digits(phone)).maybeSingle();
  return data ? mapContact(data as Record<string, unknown>) : null;
}

export async function countContacts(tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const { count } = await db().from("contacts").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active");
  return count ?? 0;
}

// ── Opt-outs ──────────────────────────────────────────────────────────────────
export async function addOptout(phone: string, reason?: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_optouts").upsert({ tenant_id: tenantId, phone: last10(phone), reason: reason ?? null }, { onConflict: "tenant_id,phone" });
  await db().from("contacts").update({ status: "optedout" }).eq("tenant_id", tenantId).eq("phone", digits(phone));
}

export async function removeOptout(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_optouts").delete().eq("tenant_id", tenantId).eq("phone", last10(phone));
  await db().from("contacts").update({ status: "active" }).eq("tenant_id", tenantId).eq("phone", digits(phone));
}

export async function listOptouts(tenantId = DEFAULT_TENANT_ID): Promise<{ phone: string; reason: string | null; createdAt: string }[]> {
  const { data } = await db().from("wa_optouts").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => ({ phone: r.phone as string, reason: (r.reason as string | null) ?? null, createdAt: r.created_at as string }));
}

// Opt-outs are per-tenant — a STOP for one business never suppresses sends for
// another (separate WhatsApp numbers, separate consent).
export async function optoutSet(tenantId = DEFAULT_TENANT_ID): Promise<Set<string>> {
  const { data } = await db().from("wa_optouts").select("phone").eq("tenant_id", tenantId);
  return new Set((data ?? []).map(r => last10(r.phone as string)));
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export async function createCampaign(p: Partial<Campaign> & { templateName: string }, tenantId = DEFAULT_TENANT_ID): Promise<Campaign> {
  const { data, error } = await db().from("wa_campaigns").insert({
    tenant_id: tenantId,
    name: p.name ?? null,
    template_name: p.templateName,
    language_code: p.languageCode ?? "en_US",
    variables: p.variables ?? [],
    header_image_url: p.headerImageUrl ?? null,
    audience: p.audience ?? null,
    status: p.status ?? "draft",
    total_recipients: p.totalRecipients ?? 0,
    scheduled_for: p.scheduledFor ?? null,
    auto_send_enabled: p.autoSendEnabled ?? false,
    auto_send_trigger: p.autoSendTrigger ?? null,
    trigger_key: p.triggerKey ?? null,
    delay_value: p.delayValue ?? 0,
    delay_unit: p.delayUnit ?? "minutes",
    ...(p.channelId ? { channel_id: p.channelId } : {}),
  }).select().single();
  if (error) throw error;
  return mapCampaign(data as Record<string, unknown>);
}

// tenantId optional: cron resolves campaigns by id (tenant-agnostic) and reads
// the owner from the row; admin routes pass the session tenant to scope access.
export async function getCampaign(id: string, tenantId?: string): Promise<Campaign | null> {
  let q = db().from("wa_campaigns").select("*").eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function listCampaigns(tenantId = DEFAULT_TENANT_ID): Promise<Campaign[]> {
  const { data, error } = await db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", false).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

export async function updateCampaign(id: string, p: Partial<{ status: CampaignStatus; sentCount: number; failedCount: number; errorSummary: string | null; sentAt: string | null; totalRecipients: number; scheduledFor: string | null }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.sentCount !== undefined) row.sent_count = p.sentCount;
  if (p.failedCount !== undefined) row.failed_count = p.failedCount;
  if (p.errorSummary !== undefined) row.error_summary = p.errorSummary;
  if (p.sentAt !== undefined) row.sent_at = p.sentAt;
  if (p.totalRecipients !== undefined) row.total_recipients = p.totalRecipients;
  if (p.scheduledFor !== undefined) row.scheduled_for = p.scheduledFor;
  const { error } = await db().from("wa_campaigns").update(row).eq("id", id);
  if (error) throw error;
}

export async function getDueScheduledCampaigns(limit = 25): Promise<Campaign[]> {
  const { data } = await db().from("wa_campaigns").select("*").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(limit);
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

// ── Auto-send configs ───────────────────────────────────────────────────────
export async function getAutoSend(trigger: AutoTrigger, triggerKey: string | null, tenantId = DEFAULT_TENANT_ID): Promise<Campaign | null> {
  let q = db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", true).eq("auto_send_trigger", trigger);
  if (triggerKey) q = q.eq("trigger_key", triggerKey);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function listAutomations(tenantId = DEFAULT_TENANT_ID): Promise<Campaign[]> {
  const { data } = await db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", true).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

export async function disableAutomation(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_campaigns").update({ auto_send_enabled: false }).eq("tenant_id", tenantId).eq("id", id);
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export async function enqueue(campaignId: string, recipients: { phone: string; fullName: string }[], tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const seen = new Set<string>();
  const rows = recipients
    .filter(r => { const k = last10(r.phone); if (!k || seen.has(k)) return false; seen.add(k); return digits(r.phone).length >= 10; })
    .map(r => ({ tenant_id: tenantId, campaign_id: campaignId, phone: digits(r.phone), recipient_name: r.fullName ?? "", status: "pending" }));
  if (rows.length === 0) return 0;
  const { data, error } = await db().from("wa_send_queue").upsert(rows, { onConflict: "campaign_id,phone", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function claimPending(campaignId: string, limit: number): Promise<{ id: string; phone: string; fullName: string }[]> {
  const { data } = await db().from("wa_send_queue").select("id, phone, recipient_name").eq("campaign_id", campaignId).eq("status", "pending").order("created_at").limit(limit);
  return (data ?? []).map(r => ({ id: r.id as string, phone: r.phone as string, fullName: (r.recipient_name as string) ?? "" }));
}

export async function markQueue(ids: string[], status: "sent" | "failed" | "skipped"): Promise<void> {
  if (ids.length === 0) return;
  await db().from("wa_send_queue").update({ status, processed_at: new Date().toISOString() }).in("id", ids);
}

export async function countPending(campaignId: string): Promise<number> {
  const { count } = await db().from("wa_send_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending");
  return count ?? 0;
}

export async function countQueueTotal(campaignId: string): Promise<number> {
  const { count } = await db().from("wa_send_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).neq("status", "cancelled");
  return count ?? 0;
}

export async function campaignsWithPending(): Promise<string[]> {
  const { data } = await db().from("wa_send_queue").select("campaign_id").eq("status", "pending").limit(1000);
  return [...new Set((data ?? []).map(r => r.campaign_id as string))];
}

// ── Send log ──────────────────────────────────────────────────────────────────
export async function insertLog(entries: { campaignId: string; phone: string; recipientName: string; status: "sent" | "failed" | "skipped"; errorDetail?: string; metaMessageId?: string }[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  if (entries.length === 0) return;
  await db().from("wa_send_log").insert(entries.map(e => ({
    tenant_id: tenantId,
    campaign_id: e.campaignId, phone: e.phone, recipient_name: e.recipientName,
    status: e.status, error_detail: e.errorDetail ?? null, meta_message_id: e.metaMessageId ?? null,
  })));
}

export async function logCounts(campaignId: string): Promise<{ sent: number; failed: number; delivered: number; read: number }> {
  const { data } = await db().from("wa_send_log").select("phone, status").eq("campaign_id", campaignId);
  const rank: Record<string, number> = { read: 4, delivered: 3, sent: 2, failed: 1, skipped: 0 };
  const best = new Map<string, string>();
  for (const r of data ?? []) {
    const k = last10(r.phone as string), s = r.status as string;
    const cur = best.get(k);
    if (cur === undefined || (rank[s] ?? -1) > (rank[cur] ?? -1)) best.set(k, s);
  }
  let sent = 0, failed = 0, delivered = 0, read = 0;
  for (const s of best.values()) {
    if (s === "read") { read++; delivered++; sent++; }
    else if (s === "delivered") { delivered++; sent++; }
    else if (s === "sent") sent++;
    else if (s === "failed") failed++;
  }
  return { sent, failed, delivered, read };
}

export async function updateLogByMessageId(metaMessageId: string, status: "delivered" | "read", at: string): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (status === "delivered") row.delivered_at = at;
  if (status === "read") { row.read_at = at; row.delivered_at = at; }
  await db().from("wa_send_log").update(row).eq("meta_message_id", metaMessageId);
}

// Per-tenant daily sent count — each tenant's volume counts against its own cap
// so one tenant can never consume another's daily headroom.
export async function dailySentCount(tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { count } = await db().from("wa_send_log").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("sent_at", since.toISOString()).in("status", ["sent", "delivered", "read"]);
  return count ?? 0;
}

// ── Scheduled (auto-send) ─────────────────────────────────────────────────────
export async function scheduleSend(p: { campaignId: string; contactId: string | null; phone: string; recipientName: string; trigger: string; sendAfter: string }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_scheduled_sends").insert({
    tenant_id: tenantId,
    campaign_id: p.campaignId, contact_id: p.contactId, phone: digits(p.phone),
    recipient_name: p.recipientName, trigger: p.trigger, send_after: p.sendAfter, status: "pending",
  });
}

export async function getDueScheduledSends(limit = 150): Promise<{ id: string; campaignId: string; phone: string; recipientName: string }[]> {
  const { data } = await db().from("wa_scheduled_sends").select("id, campaign_id, phone, recipient_name").eq("status", "pending").lte("send_after", new Date().toISOString()).order("send_after").limit(limit);
  return (data ?? []).map(r => ({ id: r.id as string, campaignId: r.campaign_id as string, phone: r.phone as string, recipientName: (r.recipient_name as string) ?? "" }));
}

export async function markScheduled(id: string, status: "sent" | "skipped" | "failed", error?: string): Promise<void> {
  await db().from("wa_scheduled_sends").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("id", id);
}

// ── Conversations (two-way / AI assistant) ────────────────────────────────────
export type ConvStatus = "active" | "paused" | "escalated";

export interface Conversation {
  id: string;
  phone: string;
  contactId: string | null;
  name: string;
  status: ConvStatus;
  botEnabled: boolean;
  lastMessage: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  needsReply: boolean;
  labels: string[];
  assignedTo: string | null;
  welcomed: boolean;
  agentId: string | null;
  aiReplyCount: number;         // AI auto-replies sent so far (capped before human handoff)
  platform: "whatsapp" | "instagram";   // which channel this chat arrived on
  avatarUrl: string | null;     // profile image (Instagram); null for WhatsApp
  channelId: string | null;     // which WhatsApp number this chat lives on
  tenantId: string;             // owning tenant
  createdAt: string;
}

export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  source: "inbound" | "bot" | "agent";
  createdAt: string;
}

function mapConversation(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string,
    phone: r.phone as string,
    contactId: (r.contact_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    status: (r.status as ConvStatus) ?? "active",
    botEnabled: (r.bot_enabled as boolean) ?? true,
    lastMessage: (r.last_message as string | null) ?? null,
    lastInboundAt: (r.last_inbound_at as string | null) ?? null,
    lastOutboundAt: (r.last_outbound_at as string | null) ?? null,
    needsReply: (r.needs_reply as boolean) ?? false,
    labels: (r.labels as string[]) ?? [],
    assignedTo: (r.assigned_to as string | null) ?? null,
    welcomed: (r.welcomed as boolean) ?? false,
    agentId: (r.agent_id as string | null) ?? null,
    aiReplyCount: (r.ai_reply_count as number) ?? 0,
    platform: (r.platform as "whatsapp" | "instagram") ?? "whatsapp",
    avatarUrl: (r.avatar_url as string | null) ?? null,
    channelId: (r.channel_id as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    createdAt: r.created_at as string,
  };
}

// Store a conversation's profile image (Instagram). Keyed by id (globally-unique).
export async function setConversationAvatar(conversationId: string, url: string): Promise<void> {
  await db().from("wa_conversations").update({ avatar_url: url }).eq("id", conversationId).then(() => {}, () => {});
}

// Bump the AI auto-reply counter (used to cap before handing off to a human).
// Keyed by conversation id (a globally-unique uuid), like touchInbound.
export async function incAiReplies(conversationId: string, current: number): Promise<void> {
  await db().from("wa_conversations").update({ ai_reply_count: current + 1 }).eq("id", conversationId).then(() => {}, () => {});
}

// Hand a conversation off to a human: escalate, flag for reply, stop the bot.
export async function escalateConversation(conversationId: string): Promise<void> {
  await db().from("wa_conversations").update({ status: "escalated", needs_reply: true, bot_enabled: false }).eq("id", conversationId).then(() => {}, () => {});
}

// Find-or-create by phone. Keeps the latest name if provided; stamps the
// channel (receiving number) on create or when it was unknown.
export async function getOrCreateConversation(phone: string, name?: string, channelId?: string | null, platform: "whatsapp" | "instagram" = "whatsapp", tenantId = DEFAULT_TENANT_ID): Promise<Conversation> {
  // IG uses non-numeric IGSIDs, so only digit-normalize WhatsApp identifiers.
  const p = platform === "instagram" ? phone.trim() : digits(phone);
  const existing = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", p).maybeSingle();
  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (name && name.trim() && !row.name) patch.name = name.trim();
    if (channelId && !row.channel_id) patch.channel_id = channelId;
    if (Object.keys(patch).length) {
      const { error } = await db().from("wa_conversations").update(patch).eq("tenant_id", tenantId).eq("phone", p);
      if (!error) Object.assign(row, patch);
    }
    return mapConversation(row);
  }
  const contact = platform === "instagram" ? null : await getContactByPhone(p, tenantId);
  const base: Record<string, unknown> = { tenant_id: tenantId, phone: p, name: (name ?? contact?.name ?? "").trim(), contact_id: contact?.id ?? null, platform };
  let ins = await db().from("wa_conversations").insert(channelId ? { ...base, channel_id: channelId } : base).select().single();
  // channel_id / platform column missing (migration not applied) — retry minimal.
  if (ins.error) ins = await db().from("wa_conversations").insert({ tenant_id: tenantId, phone: p, name: (name ?? "").trim() }).select().single();
  if (ins.error) {
    // Race: another inbound created it first — re-read.
    const retry = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", p).single();
    return mapConversation(retry.data as Record<string, unknown>);
  }
  return mapConversation(ins.data as Record<string, unknown>);
}

// Read-only lookup by phone — used by the CRM panel, which must not create
// empty conversations just because an agent opened the tab.
export async function getConversationByPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Conversation | null> {
  const { data } = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", digits(phone)).maybeSingle();
  return data ? mapConversation(data as Record<string, unknown>) : null;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data } = await db().from("wa_conversations").select("*").eq("id", id).maybeSingle();
  return data ? mapConversation(data as Record<string, unknown>) : null;
}

export async function listConversations(opts: { status?: ConvStatus | null; limit?: number; tenantId?: string } = {}): Promise<Conversation[]> {
  let q = db().from("wa_conversations").select("*").eq("tenant_id", opts.tenantId ?? DEFAULT_TENANT_ID).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(Math.min(200, opts.limit ?? 100));
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data ?? []).map(r => mapConversation(r as Record<string, unknown>));
}

export async function appendConvMessage(p: { conversationId: string; role: "user" | "assistant"; body: string; metaId?: string | null; source: "inbound" | "bot" | "agent"; tenantId?: string }): Promise<void> {
  const { error } = await db().from("wa_conv_messages").insert({
    tenant_id: p.tenantId ?? DEFAULT_TENANT_ID, conversation_id: p.conversationId, role: p.role, body: p.body,
    meta_message_id: p.metaId ?? null, source: p.source,
  });
  // Duplicate meta_message_id (webhook retry) is expected — swallow unique violations.
  if (error && error.code !== "23505") throw error;
}

export async function getConvHistory(conversationId: string, limit = 20): Promise<ConvMessage[]> {
  const { data } = await db().from("wa_conv_messages")
    .select("id, role, body, source, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(limit);
  const rows = (data ?? []).reverse();
  return rows.map(r => ({ id: r.id as string, role: r.role as "user" | "assistant", body: r.body as string, source: (r.source as ConvMessage["source"]) ?? "bot", createdAt: r.created_at as string }));
}

// Already-logged check (idempotency before doing LLM work on a retried webhook).
export async function messageLogged(metaId: string): Promise<boolean> {
  const { count } = await db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("meta_message_id", metaId);
  return (count ?? 0) > 0;
}

export async function setConversationStatus(id: string, status: ConvStatus): Promise<void> {
  await db().from("wa_conversations").update({ status }).eq("id", id);
}

export async function setBotEnabled(id: string, enabled: boolean): Promise<void> {
  await db().from("wa_conversations").update({ bot_enabled: enabled }).eq("id", id);
}

export async function touchInbound(id: string, lastMessage: string): Promise<void> {
  await db().from("wa_conversations").update({
    last_inbound_at: new Date().toISOString(), last_message: lastMessage.slice(0, 280), needs_reply: true,
  }).eq("id", id);
}

export async function touchOutbound(id: string, lastMessage: string): Promise<void> {
  await db().from("wa_conversations").update({
    last_outbound_at: new Date().toISOString(), last_message: lastMessage.slice(0, 280), needs_reply: false,
  }).eq("id", id);
}

// Atomically claim a conversation for replying: flips needs_reply true→false and
// returns true only to the caller that won. Prevents the worker + cron sweep from
// both replying to the same inbound message.
export async function claimReply(id: string): Promise<boolean> {
  const { data } = await db().from("wa_conversations")
    .update({ needs_reply: false }).eq("id", id).eq("needs_reply", true).select("id");
  return (data?.length ?? 0) > 0;
}

// Re-flag a conversation for reply (e.g. when a claimed reply attempt failed).
export async function reflagReply(id: string): Promise<void> {
  await db().from("wa_conversations").update({ needs_reply: true }).eq("id", id);
}

// Conversations with an unanswered inbound (cron fallback for dropped reply jobs).
export async function conversationsNeedingReply(limit = 20): Promise<Conversation[]> {
  const { data } = await db().from("wa_conversations").select("*")
    .eq("needs_reply", true).eq("status", "active").eq("bot_enabled", true)
    .order("last_inbound_at", { ascending: true }).limit(limit);
  return (data ?? []).map(r => mapConversation(r as Record<string, unknown>));
}

// ── Knowledge base (RAG) ──────────────────────────────────────────────────────
export type KbStatus = "processing" | "ready" | "failed";
export type KbSourceType = "pdf" | "docx" | "text" | "url";

export interface KbDocument {
  id: string;
  title: string;
  sourceType: KbSourceType;
  sourceRef: string | null;
  status: KbStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
}

function mapDocument(r: Record<string, unknown>): KbDocument {
  return {
    id: r.id as string,
    title: r.title as string,
    sourceType: r.source_type as KbSourceType,
    sourceRef: (r.source_ref as string | null) ?? null,
    status: r.status as KbStatus,
    error: (r.error as string | null) ?? null,
    chunkCount: (r.chunk_count as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function createDocument(p: { title: string; sourceType: KbSourceType; sourceRef?: string | null }, tenantId = DEFAULT_TENANT_ID): Promise<KbDocument> {
  const { data, error } = await db().from("kb_documents").insert({
    tenant_id: tenantId, title: p.title, source_type: p.sourceType, source_ref: p.sourceRef ?? null, status: "processing",
  }).select().single();
  if (error) throw error;
  return mapDocument(data as Record<string, unknown>);
}

export async function setDocStatus(id: string, status: KbStatus, extra: { chunkCount?: number; error?: string | null } = {}, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (extra.chunkCount !== undefined) row.chunk_count = extra.chunkCount;
  if (extra.error !== undefined) row.error = extra.error;
  await db().from("kb_documents").update(row).eq("tenant_id", tenantId).eq("id", id);
}

export async function listDocuments(tenantId = DEFAULT_TENANT_ID): Promise<KbDocument[]> {
  const { data } = await db().from("kb_documents").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map(r => mapDocument(r as Record<string, unknown>));
}

export async function deleteDocument(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("kb_documents").delete().eq("tenant_id", tenantId).eq("id", id);   // chunks cascade
}

// Replace a document's chunks (delete-then-insert) so re-ingest doesn't duplicate.
export async function replaceChunks(documentId: string, chunks: { content: string; embedding: number[] }[], tenantId = DEFAULT_TENANT_ID): Promise<number> {
  await db().from("kb_chunks").delete().eq("tenant_id", tenantId).eq("document_id", documentId);
  if (chunks.length === 0) return 0;
  const rows = chunks.map((c, i) => ({ tenant_id: tenantId, document_id: documentId, chunk_index: i, content: c.content, embedding: c.embedding }));
  // Insert in batches to stay under request-size limits.
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db().from("kb_chunks").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }
  return rows.length;
}

export async function matchChunks(queryEmbedding: number[], k = 6, tenantId = DEFAULT_TENANT_ID): Promise<{ content: string; documentId: string; similarity: number }[]> {
  const { data, error } = await db().rpc("match_kb_chunks", { query_embedding: queryEmbedding, match_count: k, p_tenant_id: tenantId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({ content: r.content as string, documentId: r.document_id as string, similarity: r.similarity as number }));
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export interface Analytics {
  contacts: { active: number; optedOut: number };
  campaigns: { total: number; automations: number };
  conversations: { total: number; active: number; escalated: number; needsReply: number };
  kb: { documents: number; ready: number };
  messaging: { sentToday: number; totals: { sent: number; delivered: number; read: number; failed: number } };
  daily: { date: string; sent: number; delivered: number; read: number; failed: number }[];
}

async function countWhere(table: string, filters: Record<string, unknown> = {}): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { count } = await q;
  return count ?? 0;
}

export async function getAnalytics(tenantId = DEFAULT_TENANT_ID): Promise<Analytics> {
  const since = new Date(); since.setDate(since.getDate() - 13); since.setHours(0, 0, 0, 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const t = { tenant_id: tenantId };

  const [active, optedOut, campaignsTotal, automations, convTotal, convActive, convEscalated, convNeedsReply, kbTotal, kbReady] = await Promise.all([
    countWhere("contacts", { ...t, status: "active" }),
    countWhere("wa_optouts", t),
    countWhere("wa_campaigns", { ...t, auto_send_enabled: false }),
    countWhere("wa_campaigns", { ...t, auto_send_enabled: true }),
    countWhere("wa_conversations", t),
    countWhere("wa_conversations", { ...t, status: "active" }),
    countWhere("wa_conversations", { ...t, status: "escalated" }),
    countWhere("wa_conversations", { ...t, needs_reply: true }),
    countWhere("kb_documents", t),
    countWhere("kb_documents", { ...t, status: "ready" }),
  ]);

  // Last 14 days of send-log rows, aggregated per day in JS (internal-tool scale).
  const { data: logRows } = await db().from("wa_send_log")
    .select("status, sent_at").eq("tenant_id", tenantId).gte("sent_at", since.toISOString())
    .order("sent_at", { ascending: false }).limit(20000);

  const byDay = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since); d.setDate(since.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), { sent: 0, delivered: 0, read: 0, failed: 0 });
  }
  const totals = { sent: 0, delivered: 0, read: 0, failed: 0 };
  let sentToday = 0;
  for (const r of logRows ?? []) {
    const day = (r.sent_at as string).slice(0, 10);
    const bucket = byDay.get(day);
    const s = r.status as string;
    // read implies delivered implies sent
    const inc = (k: "sent" | "delivered" | "read" | "failed") => { if (bucket) bucket[k]++; totals[k]++; };
    if (s === "read") { inc("sent"); inc("delivered"); inc("read"); }
    else if (s === "delivered") { inc("sent"); inc("delivered"); }
    else if (s === "sent") inc("sent");
    else if (s === "failed") inc("failed");
    if (s !== "failed" && s !== "skipped" && new Date(r.sent_at as string) >= todayStart) sentToday++;
  }

  return {
    contacts: { active, optedOut },
    campaigns: { total: campaignsTotal, automations },
    conversations: { total: convTotal, active: convActive, escalated: convEscalated, needsReply: convNeedsReply },
    kb: { documents: kbTotal, ready: kbReady },
    messaging: { sentToday, totals },
    daily: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

// ── Quick replies (canned responses) ─────────────────────────────────────────
export interface QuickReply { id: string; shortcut: string; body: string; createdAt: string }

export async function listQuickReplies(tenantId = DEFAULT_TENANT_ID): Promise<QuickReply[]> {
  const { data } = await db().from("wa_quick_replies").select("*").eq("tenant_id", tenantId).order("shortcut");
  return (data ?? []).map(r => ({ id: r.id as string, shortcut: r.shortcut as string, body: r.body as string, createdAt: r.created_at as string }));
}

export async function createQuickReply(shortcut: string, body: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_quick_replies").upsert({ tenant_id: tenantId, shortcut: shortcut.trim().toLowerCase(), body: body.trim() }, { onConflict: "tenant_id,shortcut" });
  if (error) throw error;
}

export async function deleteQuickReply(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_quick_replies").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

// ── Settings (welcome message, working hours, away message) ──────────────────
// Global helpers resolve to the default tenant; they delegate to the tenant
// accessors below so the composite (tenant_id, key) conflict target is used.
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return getTenantSetting(DEFAULT_TENANT_ID, key, fallback);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  return setTenantSetting(DEFAULT_TENANT_ID, key, value);
}

// ── Tenant-scoped settings + secret vault (SaaS) ─────────────────────────────
// Per-tenant config and secrets. Secrets (Meta access tokens, API keys) are
// encrypted at rest via crypto.ts before they ever reach the DB. The wa_settings
// uniqueness must be (tenant_id, key) — see 0020 constraint migration (pending).
export async function getTenantSetting<T>(tenantId: string, key: string, fallback: T): Promise<T> {
  const { data } = await tdb(tenantId).from("wa_settings").select("value").eq("key", key).maybeSingle();
  return ((data as { value?: T } | null)?.value as T) ?? fallback;
}

export async function setTenantSetting(tenantId: string, key: string, value: unknown): Promise<void> {
  const { error } = await tdb(tenantId)
    .from("wa_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" });
  if (error) throw error;
}

// Store an encrypted secret under a settings key. Never persists plaintext.
export async function setTenantSecret(tenantId: string, key: string, plaintext: string): Promise<void> {
  await setTenantSetting(tenantId, key, { enc: encryptSecret(plaintext) });
}

// Read + decrypt a secret. Returns null if unset; tolerates legacy plaintext.
export async function getTenantSecret(tenantId: string, key: string): Promise<string | null> {
  const v = await getTenantSetting<{ enc?: string } | string | null>(tenantId, key, null);
  if (!v) return null;
  if (typeof v === "string") return readSecret(v);          // legacy plaintext
  return v.enc ? readSecret(v.enc) : null;
}

// ── Conversation labels / assignment / welcome tracking ──────────────────────
export async function setConvLabels(id: string, labels: string[]): Promise<void> {
  const clean = [...new Set(labels.map(l => l.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  const { error } = await db().from("wa_conversations").update({ labels: clean }).eq("id", id);
  if (error) throw error;
}

export async function assignConversation(id: string, assignedTo: string | null): Promise<void> {
  const { error } = await db().from("wa_conversations").update({ assigned_to: assignedTo?.trim() || null }).eq("id", id);
  if (error) throw error;
}

// Pin a conversation to a specific AI agent (null → globally active agent).
export async function setConversationAgent(id: string, agentId: string | null): Promise<void> {
  const { error } = await db().from("wa_conversations").update({ agent_id: agentId }).eq("id", id);
  if (error) throw error;
}

// Atomically claims the welcome send: only the first caller gets true.
export async function claimWelcome(id: string): Promise<boolean> {
  const { data } = await db().from("wa_conversations").update({ welcomed: true }).eq("id", id).eq("welcomed", false).select("id");
  return (data?.length ?? 0) > 0;
}

// ── Campaign funnel + smart retargeting ──────────────────────────────────────
export interface CampaignFunnel {
  total: number;
  sent: number;        // reached Meta but no delivery receipt yet
  delivered: number;   // delivered, not read
  read: number;
  failed: number;
  skipped: number;
}

export type RetargetSegment = "delivered_not_read" | "sent_not_delivered" | "read" | "failed";
const SEGMENT_STATUS: Record<RetargetSegment, string> = {
  delivered_not_read: "delivered", sent_not_delivered: "sent", read: "read", failed: "failed",
};

export async function campaignFunnel(campaignId: string): Promise<CampaignFunnel> {
  const f: CampaignFunnel = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
  // status column progresses sent → delivered → read, so each row counts once.
  for (const s of ["sent", "delivered", "read", "failed", "skipped"] as const) {
    const { count } = await db().from("wa_send_log").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).eq("status", s);
    f[s] = count ?? 0;
  }
  f.total = f.sent + f.delivered + f.read + f.failed + f.skipped;
  return f;
}

// Recipients for a behavioral retarget — excludes anyone who has opted out since.
export async function retargetRecipients(campaignId: string, segment: RetargetSegment, tenantId = DEFAULT_TENANT_ID): Promise<{ phone: string; fullName: string }[]> {
  const { data, error } = await db().from("wa_send_log").select("phone, recipient_name")
    .eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", SEGMENT_STATUS[segment]).limit(10000);
  if (error) throw error;
  const optedOut = await optoutSet(tenantId);
  const seen = new Set<string>();
  const out: { phone: string; fullName: string }[] = [];
  for (const r of data ?? []) {
    const phone = (r.phone as string) ?? "";
    if (seen.has(phone) || optedOut.has(last10(phone))) continue;
    seen.add(phone);
    out.push({ phone, fullName: (r.recipient_name as string) ?? "" });
  }
  return out;
}
