import { DEFAULT_TENANT_ID } from "./tenant";
// Multi-number / multi-WABA channels. Every sender accepts an optional
// ChannelCreds; when omitted (or when wa_channels is empty / migration 0013
// not applied) the META_WA_* env credentials are used — so single-number
// setups keep working with zero configuration.

import { randomBytes } from "crypto";
import { db } from "./supabase";
import { encryptSecret, readSecret } from "./crypto";


export interface ChannelCreds {
  token: string;
  phoneId: string;
  wabaId: string;
  appId?: string | null;
}

export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "webchat" | "youtube" | "google_reviews";

// Web-chat widget look & feel (kind="webchat"), injected into the embed loader.
export interface WebchatConfig {
  color?: string;                 // brand hex — bubble + header + visitor msgs
  title?: string;                 // header text, e.g. "Chat with us"
  welcome?: string;               // greeting shown when the panel first opens
  position?: "right" | "left";    // launcher corner (default right)
  iconUrl?: string;               // custom launcher icon (uploaded logo); default = chat bubble
  subtitle?: string;              // header sub-line under the title, e.g. "Typically replies instantly"
  logoFit?: "cover" | "contain"; // "cover" = crop to circle (default); "contain" = show the whole logo, any shape
  badgeColor?: string;            // launcher circle colour behind a contain-fit logo (default white)
  logoScale?: number;             // % of the launcher the logo fills (30-200; >100 zoom-crops logos with built-in padding)
  offsetSide?: number;            // px gap from the left/right edge (default 20) — dodge the site's own floating buttons
  offsetBottom?: number;          // px gap from the bottom edge (default 20) — e.g. 100 clears a scroll-to-top button
}

export interface Channel extends ChannelCreds {
  id: string;
  tenantId: string;
  kind: ChannelKind;
  name: string;
  igUserId: string | null;    // IG professional account id (Messaging API), null for WA
  pageId: string | null;      // connected Facebook Page id (IG)
  ytChannelId: string | null; // YouTube channel id (kind="youtube"); token = OAuth refresh token
  googleAccountId: string | null;   // Business Profile account resource id (kind="google_reviews")
  googleLocationId: string | null;  // Business Profile location resource id; token = OAuth refresh token
  agentId: string | null;     // default AI persona for conversations on this number
  kbTag: string | null;       // default KB topic for AI answers on this number (null = tenant-wide KB)
  crmSource: string | null;   // CRM lead Source for NEW leads that arrive on this number (null = "WhatsApp"); e.g. "ppc-whatsapp" so per-number campaigns are attributable
  mode: "full" | "manual";    // "manual" = personal line: no AI/flow/welcome/sequence/follow-up
  commentAi: boolean;         // IG: may the AI publicly answer comments with no matching rule (default true)
  coex: boolean;              // coexistence: number is ALSO active on the WhatsApp Business phone app
  active: boolean;
  isDefault: boolean;
  createdAt: string;
  // Meta health — drives auto-pause so a degraded number stops broadcasting.
  qualityRating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | null;
  messagingHealth: string | null;   // AVAILABLE | FLAGGED | RESTRICTED
  marketingPaused: boolean;
  messagingTier: string | null;     // TIER_250 | TIER_1K | TIER_10K | TIER_100K | TIER_UNLIMITED
  // Web-chat widget (kind="webchat"): public embed key + CORS origin allowlist.
  siteKey: string | null;
  allowedOrigins: string[];
  widgetConfig: WebchatConfig;   // look & feel (color, title, welcome, position)
}

// The per-24h send allowance implied by a Meta messaging-limit tier. null tier
// (unknown) → null so callers fall back to their configured safety cap.
export function tierDailyCap(tier: string | null | undefined): number | null {
  switch (tier) {
    case "TIER_50": return 50;
    case "TIER_250": return 250;
    case "TIER_1K": return 1000;
    case "TIER_10K": return 10000;
    case "TIER_100K": return 100000;
    case "TIER_UNLIMITED": return Number.POSITIVE_INFINITY;
    default: return null;
  }
}

function mapChannel(r: Record<string, unknown>): Channel {
  return {
    id: r.id as string,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    kind: ((r.kind as ChannelKind) ?? "whatsapp"),
    name: r.name as string,
    // Tokens are stored encrypted (crypto.ts); readSecret tolerates legacy plaintext.
    token: readSecret(r.access_token as string) ?? "",
    phoneId: (r.phone_number_id as string) ?? "",
    wabaId: (r.waba_id as string) ?? "",
    igUserId: (r.ig_user_id as string | null) ?? null,
    pageId: (r.page_id as string | null) ?? null,
    ytChannelId: (r.yt_channel_id as string | null) ?? null,
    googleAccountId: (r.google_account_id as string | null) ?? null,
    googleLocationId: (r.google_location_id as string | null) ?? null,
    appId: (r.app_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    kbTag: (r.kb_tag as string | null) ?? null,
    crmSource: (r.crm_source as string | null) ?? null,
    mode: (r.mode as string) === "manual" ? "manual" : "full",
    commentAi: (r.comment_ai as boolean) ?? true,
    coex: (r.coex as boolean) ?? false,
    active: (r.active as boolean) ?? true,
    isDefault: (r.is_default as boolean) ?? false,
    createdAt: r.created_at as string,
    qualityRating: (r.quality_rating as Channel["qualityRating"]) ?? null,
    messagingHealth: (r.messaging_health as string | null) ?? null,
    marketingPaused: (r.marketing_paused as boolean) ?? false,
    messagingTier: (r.messaging_tier as string | null) ?? null,
    siteKey: (r.site_key as string | null) ?? null,
    allowedOrigins: (r.allowed_origins as string[] | null) ?? [],
    widgetConfig: (r.widget_config as WebchatConfig | null) ?? {},
  };
}

// True when this channel is safe to send MARKETING on. A RED quality rating or a
// FLAGGED/RESTRICTED messaging health (or an explicit pause) means Meta is about
// to restrict the number — continuing to broadcast is what gets it disabled.
export function isMarketingSendable(c: Pick<Channel, "qualityRating" | "messagingHealth" | "marketingPaused">): boolean {
  if (c.marketingPaused) return false;
  if (c.qualityRating === "RED") return false;
  if (c.messagingHealth === "FLAGGED" || c.messagingHealth === "RESTRICTED") return false;
  return true;
}

// Persist a quality/health signal (from the Meta webhook or a Graph API poll) and
// auto-pause marketing when it indicates trouble. Matches channels by WABA id
// (the webhook entry.id) and/or phone_number_id. Best-effort: never throws.
export async function recordChannelQuality(match: { wabaId?: string | null; phoneNumberId?: string | null }, signal: { rating?: string | null; health?: string | null; event?: string | null; tier?: string | null }): Promise<void> {
  const rating = signal.rating ? signal.rating.toUpperCase() : null;
  const health = signal.health ? signal.health.toUpperCase() : null;
  // Derive auto-pause: pause when RED or FLAGGED/RESTRICTED; clear when explicitly healthy.
  const bad = rating === "RED" || health === "FLAGGED" || health === "RESTRICTED" || signal.event === "FLAGGED";
  const healthy = rating === "GREEN" || health === "AVAILABLE" || signal.event === "UNFLAGGED";
  const patch: Record<string, unknown> = { quality_updated_at: new Date().toISOString() };
  if (rating) patch.quality_rating = rating;
  if (health) patch.messaging_health = health;
  if (signal.event) patch.quality_event = signal.event;
  if (signal.tier) { patch.messaging_tier = signal.tier.toUpperCase(); patch.tier_updated_at = new Date().toISOString(); }
  if (bad) patch.marketing_paused = true;
  else if (healthy) patch.marketing_paused = false;
  try {
    let q = db().from("wa_channels").update(patch);
    if (match.phoneNumberId) q = q.eq("phone_number_id", match.phoneNumberId);
    else if (match.wabaId) q = q.eq("waba_id", match.wabaId);
    else return;
    await q;
  } catch (e) { console.error("[channels] recordChannelQuality", e); }
}

export async function listChannels(tenantId?: string): Promise<Channel[]> {
  try {
    let q = db().from("wa_channels").select("*").order("created_at", { ascending: true });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(mapChannel);
  } catch { return []; }     // table missing → env single-number mode
}

// Single source of truth for "which of these tenants have at least one active
// channel" — batched so callers processing many tenants at once (e.g. the
// onboarding-nudge cron) don't hand-roll their own copy of this query that can
// silently drift from the single-tenant check below.
export async function tenantsWithActiveChannel(tenantIds: string[]): Promise<Set<string>> {
  if (!tenantIds.length) return new Set();
  const { data } = await db().from("wa_channels").select("tenant_id").eq("active", true).in("tenant_id", tenantIds);
  return new Set((data ?? []).map(r => r.tenant_id as string));
}

export async function hasActiveChannel(tenantId: string): Promise<boolean> {
  return (await tenantsWithActiveChannel([tenantId])).has(tenantId);
}

// The tenant's WhatsApp channel rows, THROWING on query failure — unlike
// listChannels' catch→[]. Callers making consequential decisions ("is this the
// tenant's FIRST number → make it default", "does this phone id already exist
// → update in place, don't duplicate") must fail closed rather than trust an
// empty answer produced by a transient outage.
export async function listWhatsappChannelsStrict(tenantId: string): Promise<Channel[]> {
  const { data, error } = await db().from("wa_channels").select("*").eq("tenant_id", tenantId);
  if (error) throw error;
  return (data ?? []).map(mapChannel).filter(c => c.kind === "whatsapp");
}

// When tenantId is supplied the lookup is tenant-scoped. ALWAYS pass it from any
// route that takes a client-supplied channel id, or a tenant can use another
// tenant's decrypted credentials (cross-tenant send / credential exposure).
export async function getChannel(id: string, tenantId?: string): Promise<Channel | null> {
  try {
    let q = db().from("wa_channels").select("*").eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q.maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound routing: Meta puts the receiving number's phone_number_id in every webhook.
export async function getChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | null> {
  if (!phoneNumberId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound IG routing: the webhook entry id is the IG professional account id.
export async function getChannelByIgId(igUserId: string): Promise<Channel | null> {
  if (!igUserId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("ig_user_id", igUserId).maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound Messenger routing: the page webhook's entry.id is the Facebook Page id.
// Filtered by kind so it never matches an Instagram channel that has the same
// linked Page (IG channels also store page_id).
export async function getChannelByPageId(pageId: string): Promise<Channel | null> {
  if (!pageId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("page_id", pageId).eq("kind", "messenger").maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound web-chat routing: the widget carries its public site key.
export async function getChannelBySiteKey(siteKey: string): Promise<Channel | null> {
  if (!siteKey) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("site_key", siteKey).eq("kind", "webchat").maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// Inbound YouTube routing (poll-based): match a connected channel by its YouTube
// channel id. Filtered by kind so it never collides with another channel type.
export async function getChannelByYtId(ytChannelId: string): Promise<Channel | null> {
  if (!ytChannelId) return null;
  try {
    const { data } = await db().from("wa_channels").select("*").eq("yt_channel_id", ytChannelId).eq("kind", "youtube").maybeSingle();
    return data ? mapChannel(data as Record<string, unknown>) : null;
  } catch { return null; }
}

// The channel used when a send doesn't specify one: the explicit default, else
// the first active channel, else null (= env credentials). Pass tenantId to
// avoid falling back to another tenant's channel.
export async function getDefaultChannel(tenantId?: string): Promise<Channel | null> {
  const all = (await listChannels(tenantId)).filter(c => c.active);
  return all.find(c => c.isDefault) ?? all[0] ?? null;
}

// The WhatsApp number an UNPINNED BROADCAST should leave from: the channel an
// admin explicitly marked "default for sends" WITHIN this tenant. No explicit
// default → undefined, so env credentials are used. Deliberately does NOT fall
// back to "the first channel", and REQUIRES a tenantId — a tenant-less lookup
// would scan every tenant and could return another tenant's default number.
//
// IMPORTANT: only broadcast/campaign paths use this. A conversation reply keys on
// conv.channelId, where null means "reply from the number the customer messaged",
// NOT "use the default". So credsFor() stays pure (null → env); the default
// fallback lives at the broadcast call site.
export async function explicitDefaultChannel(tenantId: string): Promise<Channel | undefined> {
  return (await listChannels(tenantId)).find(c =>
    c.isDefault && c.active && (c.kind ?? "whatsapp") === "whatsapp" && !!c.token && !!c.phoneId) ?? undefined;
}

// Resolve a channel reference (id | Channel | null/undefined) to creds-or-undefined.
// `undefined` tells the senders to use env credentials. When ref is a client-
// supplied id, pass tenantId so a foreign channel resolves to undefined rather
// than leaking another tenant's credentials.
export async function credsFor(ref?: string | Channel | null, tenantId?: string): Promise<ChannelCreds | undefined> {
  if (!ref) return undefined;
  const c = typeof ref === "string" ? await getChannel(ref, tenantId) : ref;
  return c ?? undefined;
}

// ── Per-channel AI allocation ─────────────────────────────────────────────────
// One resolution chain for every reply pipeline (WhatsApp, IG, Messenger, web
// chat): the conversation's own override wins (a flow-stamped KB tag / a pinned
// agent), then the channel's default, then the tenant's global (null → whole
// tenant KB / the tenant's active agent). Pure so the precedence is
// unit-testable without a database.
export function effectiveAgentId(
  conv: { agentId?: string | null } | null | undefined,
  channel?: { agentId?: string | null } | null,
): string | null {
  return conv?.agentId ?? channel?.agentId ?? null;
}

export function effectiveKbTag(
  conv: { primaryKbTag?: string | null } | null | undefined,
  channel?: { kbTag?: string | null } | null,
): string | null {
  return conv?.primaryKbTag ?? channel?.kbTag ?? null;
}

// phoneId/wabaId are hand-typed on the manual "add a number" admin form (the
// embedded-signup flow gets them straight from Meta's own callback instead) —
// verify the pairing against Graph at save time. Unlike Instagram's account id
// (which Meta silently aliases, so a wrong id only breaks INBOUND routing),
// WhatsApp has no aliasing: a wrong/inaccessible phoneId usually breaks
// outbound sends immediately too — but failing loudly HERE, with a clear
// message, beats discovering it via a cryptic Graph error on the first send.
export async function verifyWhatsappPhoneId(phoneId: string, token: string): Promise<{ ok: boolean; displayPhone?: string; error?: string }> {
  try {
    const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number&access_token=${encodeURIComponent(token)}`);
    const data = (await res.json().catch(() => null)) as { id?: string; display_phone_number?: string; error?: { message?: string } } | null;
    if (res.ok && data?.id) return { ok: true, displayPhone: data.display_phone_number };
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveChannel(input: Partial<Channel> & { name: string; phoneId: string; wabaId: string; token: string; tenantId?: string }): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row = {
    tenant_id: tenantId,
    name: input.name.trim(),
    phone_number_id: input.phoneId.trim(),
    waba_id: input.wabaId.trim(),
    access_token: encryptSecret(input.token.trim()),   // encrypted at rest
    app_id: input.appId?.trim() || null,
    agent_id: input.agentId || null,
    // Only written when the caller sends it (widgetConfig precedent): callers
    // that predate the kb_tag column (embedded-signup onboarding, older UIs)
    // must keep saving even before the migration is applied — an unconditional
    // write would 500 every channel save with PGRST204 until then.
    ...(input.kbTag !== undefined ? { kb_tag: input.kbTag?.trim() || null } : {}),
    ...(input.crmSource !== undefined ? { crm_source: input.crmSource?.trim() || null } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.coex !== undefined ? { coex: input.coex } : {}),
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  // Only one default at a time, per tenant.
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const runSave = (r: Record<string, unknown>) => input.id
    ? db().from("wa_channels").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(r).select().single();
  let { data, error } = await runSave(row);
  // Pre-migration safety: crm_source (0079) is the newest optional column and,
  // unlike kb_tag/coex, the channel editor sends it on EVERY save — so before
  // the migration is applied an unconditional write would 500 every save with
  // 42703/PGRST204. Drop just that key and retry so channels stay editable; the
  // source simply isn't persisted until the column exists.
  if (error && (error.code === "42703" || error.code === "PGRST204") && "crm_source" in row) {
    delete row.crm_source;
    ({ data, error } = await runSave(row));
  }
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

// Save an Instagram channel (no phone/WABA; IG account id + page instead).
// Token is encrypted at rest and the row is scoped to the tenant.
export async function saveInstagramChannel(input: {
  id?: string; tenantId?: string; name: string; igUserId: string; pageId?: string | null;
  token: string; agentId?: string | null; kbTag?: string | null; commentAi?: boolean; active?: boolean; isDefault?: boolean;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row = {
    tenant_id: tenantId,
    kind: "instagram",
    name: input.name.trim(),
    ig_user_id: input.igUserId.trim(),
    page_id: input.pageId?.trim() || null,
    access_token: encryptSecret(input.token.trim()),
    agent_id: input.agentId || null,
    // Only written when the caller sends it (widgetConfig precedent): callers
    // that predate the kb_tag column (embedded-signup onboarding, older UIs)
    // must keep saving even before the migration is applied — an unconditional
    // write would 500 every channel save with PGRST204 until then.
    ...(input.kbTag !== undefined ? { kb_tag: input.kbTag?.trim() || null } : {}),
    // Same conditional-write reason for comment_ai (migration 0085).
    ...(input.commentAi !== undefined ? { comment_ai: input.commentAi } : {}),
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const runSave = (r: Record<string, unknown>) => input.id
    ? db().from("wa_channels").update(r).eq("id", input.id!).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(r).select().single();
  let res = await runSave(row);
  // Tolerate a pre-0085 DB (comment_ai column absent) — retry once without it so
  // IG channel saves keep working until the migration is applied.
  if (res.error && /comment_ai/i.test(res.error.message ?? "") && "comment_ai" in row) {
    const rest: Record<string, unknown> = { ...row };
    delete rest.comment_ai;
    res = await runSave(rest);
  }
  if (res.error) throw res.error;
  return mapChannel(res.data as Record<string, unknown>);
}

// Save a Facebook Messenger channel (Page id + Page access token; no WABA/IG).
// Token is encrypted at rest and the row is tenant-scoped.
export async function saveMessengerChannel(input: {
  id?: string; tenantId?: string; name: string; pageId: string;
  token: string; agentId?: string | null; kbTag?: string | null; active?: boolean; isDefault?: boolean;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row = {
    tenant_id: tenantId,
    kind: "messenger",
    name: input.name.trim(),
    page_id: input.pageId.trim(),
    access_token: encryptSecret(input.token.trim()),
    agent_id: input.agentId || null,
    // Only written when the caller sends it (widgetConfig precedent): callers
    // that predate the kb_tag column (embedded-signup onboarding, older UIs)
    // must keep saving even before the migration is applied — an unconditional
    // write would 500 every channel save with PGRST204 until then.
    ...(input.kbTag !== undefined ? { kb_tag: input.kbTag?.trim() || null } : {}),
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const q = input.id
    ? db().from("wa_channels").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

// Save a YouTube channel (kind="youtube"; no phone/WABA/IG). The connected
// YouTube channel id lives in yt_channel_id and the OAuth refresh token is stored
// (encrypted) in access_token — youtube.ts exchanges it for short-lived access
// tokens at call time. Token is optional on edit (blank = keep the current one).
export async function saveYoutubeChannel(input: {
  id?: string; tenantId?: string; name: string; ytChannelId?: string;
  token?: string | null; agentId?: string | null; kbTag?: string | null; commentAi?: boolean; active?: boolean; isDefault?: boolean;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    kind: "youtube",
    name: input.name.trim(),
    // Omitted (not blank) when the channel is still "pick one" pending — a
    // multi-channel Google login's OAuth callback creates the row before the
    // admin has chosen which channel it is.
    ...(input.ytChannelId !== undefined ? { yt_channel_id: input.ytChannelId.trim() || null } : {}),
    agent_id: input.agentId || null,
    // Only written when the caller sends it (matches kb_tag/comment_ai precedent):
    // an unconditional write would 500 every save before the migration lands.
    ...(input.kbTag !== undefined ? { kb_tag: input.kbTag?.trim() || null } : {}),
    ...(input.commentAi !== undefined ? { comment_ai: input.commentAi } : {}),
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  // A refresh token is required on create; on edit a blank keeps the stored one.
  const tok = (input.token ?? "").trim();
  if (tok) row.access_token = encryptSecret(tok);
  else if (!input.id) row.access_token = "";   // access_token is NOT NULL
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const runSave = (r: Record<string, unknown>) => input.id
    ? db().from("wa_channels").update(r).eq("id", input.id!).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(r).select().single();
  let res = await runSave(row);
  // Tolerate a pre-0093 DB (yt_channel_id / comment_ai absent) — strip and retry
  // so a YouTube channel still saves until the migration is applied.
  for (let i = 0; i < 2 && res.error && /\b(yt_channel_id|comment_ai)\b/i.test(res.error.message ?? ""); i++) {
    const rest: Record<string, unknown> = { ...row };
    if (/yt_channel_id/i.test(res.error.message ?? "")) delete rest.yt_channel_id;
    if (/comment_ai/i.test(res.error.message ?? "")) delete rest.comment_ai;
    res = await runSave(rest);
  }
  if (res.error) throw res.error;
  return mapChannel(res.data as Record<string, unknown>);
}

// Save a Google Reviews channel (kind="google_reviews"; no phone/WABA/IG). The
// OAuth refresh token is stored (encrypted) in access_token, same as YouTube.
// Created right after OAuth with account/location left null and active=false
// (the tenant hasn't picked a location yet); the location picker then updates
// the same row in place via `id`.
export async function saveGoogleReviewsChannel(input: {
  id?: string; tenantId?: string; name: string; token?: string | null;
  googleAccountId?: string | null; googleLocationId?: string | null; active?: boolean;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    kind: "google_reviews",
    name: input.name.trim(),
    active: input.active ?? true,
  };
  const tok = (input.token ?? "").trim();
  if (tok) row.access_token = encryptSecret(tok);
  else if (!input.id) row.access_token = "";   // access_token is NOT NULL
  if (input.googleAccountId !== undefined) row.google_account_id = input.googleAccountId;
  if (input.googleLocationId !== undefined) row.google_location_id = input.googleLocationId;
  const runSave = (r: Record<string, unknown>) => input.id
    ? db().from("wa_channels").update(r).eq("id", input.id!).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(r).select().single();
  let res = await runSave(row);
  // Tolerate a pre-0094 DB (google_account_id/google_location_id absent).
  for (let i = 0; i < 2 && res.error && /\b(google_account_id|google_location_id)\b/i.test(res.error.message ?? ""); i++) {
    const rest: Record<string, unknown> = { ...row };
    if (/google_account_id/i.test(res.error.message ?? "")) delete rest.google_account_id;
    if (/google_location_id/i.test(res.error.message ?? "")) delete rest.google_location_id;
    res = await runSave(rest);
  }
  if (res.error) throw res.error;
  return mapChannel(res.data as Record<string, unknown>);
}

// Save a website web-chat channel. A public site_key is minted once on create
// (used in the embed script + to route inbound). allowedOrigins is the CORS
// allowlist (empty = allow any origin). No external creds / token.
// Validate/clamp widget look-&-feel before storing. The color is later injected
// into the loader's CSS, so it MUST be a strict hex (no CSS-injection escape).
export function sanitizeWidgetConfig(c: WebchatConfig | null | undefined): WebchatConfig {
  const out: WebchatConfig = {};
  const color = (c?.color ?? "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) out.color = color;
  const title = (c?.title ?? "").trim();
  if (title) out.title = title.slice(0, 40);
  const welcome = (c?.welcome ?? "").trim();
  if (welcome) out.welcome = welcome.slice(0, 300);
  if (c?.position === "left") out.position = "left";
  // Custom launcher icon: must be an https URL (it becomes an <img src> in the
  // loader). \S would still admit quote/angle chars that could break out of the
  // concatenated img markup — forbid attribute-breaking characters explicitly.
  const iconUrl = (c?.iconUrl ?? "").trim();
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(iconUrl) && iconUrl.length <= 600) out.iconUrl = iconUrl;
  const subtitle = (c?.subtitle ?? "").trim();
  if (subtitle) out.subtitle = subtitle.slice(0, 60);
  if (c?.logoFit === "contain") out.logoFit = "contain";
  // Launcher badge colour: strict hex only — it is injected into widget CSS.
  const badge = (c?.badgeColor ?? "").trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(badge)) out.badgeColor = badge;
  // Logo size inside the circular launcher, % clamped so it stays a number.
  const ls = Math.round(Number(c?.logoScale));
  if (Number.isFinite(ls)) out.logoScale = Math.min(200, Math.max(30, ls));
  // Launcher offsets: clamped ints so the CSS injection is always a plain number.
  const off = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(600, Math.max(0, n)) : undefined; };
  const os = off(c?.offsetSide); if (os !== undefined) out.offsetSide = os;
  const ob = off(c?.offsetBottom); if (ob !== undefined) out.offsetBottom = ob;
  return out;
}

export async function saveWebchatChannel(input: {
  id?: string; tenantId?: string; name: string; allowedOrigins?: string[];
  agentId?: string | null; kbTag?: string | null; active?: boolean; widgetConfig?: WebchatConfig;
}): Promise<Channel> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const origins = (input.allowedOrigins ?? []).map(o => o.trim().replace(/\/$/, "")).filter(Boolean);
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    kind: "webchat",
    name: input.name.trim(),
    // A website widget has no Meta token, but wa_channels.access_token is NOT NULL
    // (only phone_number_id/waba_id were made nullable). Store an empty string so
    // the insert succeeds; readSecret("") → "" on read.
    access_token: "",
    allowed_origins: origins,
    agent_id: input.agentId || null,
    // Only written when the caller sends it (widgetConfig precedent): callers
    // that predate the kb_tag column (embedded-signup onboarding, older UIs)
    // must keep saving even before the migration is applied — an unconditional
    // write would 500 every channel save with PGRST204 until then.
    ...(input.kbTag !== undefined ? { kb_tag: input.kbTag?.trim() || null } : {}),
    active: input.active ?? true,
  };
  if (input.widgetConfig !== undefined) row.widget_config = sanitizeWidgetConfig(input.widgetConfig);
  // Mint a stable public key once, on create only.
  if (!input.id) row.site_key = `wc_${randomBytes(16).toString("hex")}`;
  const q = input.id
    ? db().from("wa_channels").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

// Upgrade a pasted credential to the PAGE's own token. Admins routinely paste
// their user / Business-Manager system-user token — Meta answers page endpoints
// with (#210) "A page access token is required". When the supplied token has
// access to the Page, GET /{pageId}?fields=access_token returns the Page token;
// otherwise null and the caller keeps what it was given.
export async function derivePageToken(pageId: string, token: string): Promise<string | null> {
  try {
    const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(token)}`);
    const data = (await res.json().catch(() => null)) as { access_token?: string } | null;
    return res.ok && data?.access_token ? data.access_token : null;
  } catch { return null; }
}

// pageId is hand-typed on the manual "add a Page" admin form. Inbound Messenger
// webhooks match entry.id against wa_channels.page_id with an EXACT string
// match (getChannelByPageId) — a pasted typo/stale id silently drops every
// inbound event while sends (keyed off the same pasted id + its own token)
// keep working, same masking effect as the Instagram account-id bug. Ask the
// PAGE token's own /me for its id instead of trusting the pasted value.
export async function resolvePageId(pageToken: string): Promise<{ id?: string; name?: string; error?: string }> {
  try {
    const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const res = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`);
    const data = (await res.json().catch(() => null)) as { id?: string; name?: string; error?: { message?: string } } | null;
    if (res.ok && data?.id) return { id: data.id, name: data.name };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Meta only delivers Page webhooks (Messenger messages, feed comments) after
// the Page is SUBSCRIBED to the app — saving a channel from the portal used to
// skip this, so a freshly added Facebook Page stored its creds but never
// received a single event ("added it but it didn't work"). Called on every
// Messenger channel save; idempotent (re-subscribing is a no-op for Meta).
export async function subscribePageToApp(pageId: string, pageToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const fields = "messages,messaging_postbacks,messaging_optins,message_deliveries,feed";
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageToken)}`, { method: "POST" });
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
    if (res.ok && data?.success) return { ok: true, detail: "Page subscribed to the app's webhooks." };
    return { ok: false, detail: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// Meta's inbound IG webhooks stamp entry.id with the account's CANONICAL id —
// which, for accounts that have moved onto "Instagram API with Instagram
// Login", is a different (longer) id than the classic Facebook-Page-linked
// Instagram Business Account id an admin is likely to have pasted into the
// form. Sends still work with either id (Meta aliases them on the send path),
// but getChannelByIgId does an exact match on inbound — so a stale/wrong id
// here means every DM/comment silently fails to match and gets dropped. Ask
// Graph directly instead of trusting hand-typed input.
export async function resolveIgAccountId(igToken: string): Promise<{ id?: string; username?: string; error?: string }> {
  try {
    const GRAPH = `https://graph.instagram.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const res = await fetch(`${GRAPH}/me?fields=id,username&access_token=${encodeURIComponent(igToken)}`);
    const data = (await res.json().catch(() => null)) as { id?: string; username?: string; error?: { message?: string } } | null;
    if (res.ok && data?.id) return { id: data.id, username: data.username };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Instagram flavour of the same requirement (Instagram-login API): the IG
// professional account itself must be subscribed to the app for DM/comment
// webhooks to flow.
export async function subscribeIgToApp(igUserId: string, igToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const GRAPH = `https://graph.instagram.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
    const res = await fetch(`${GRAPH}/${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=${encodeURIComponent("messages,comments")}&access_token=${encodeURIComponent(igToken)}`, { method: "POST" });
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
    if (res.ok && data?.success) return { ok: true, detail: "Instagram account subscribed to the app's webhooks." };
    return { ok: false, detail: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteChannel(id: string, tenantId?: string): Promise<void> {
  let q = db().from("wa_channels").delete().eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { error } = await q;
  if (error) throw error;
}
