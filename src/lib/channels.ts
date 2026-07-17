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

export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "webchat";

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
  logoScale?: number;             // % of the launcher the logo fills (30-100; contain fit only)
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
  agentId: string | null;     // default AI persona for conversations on this number
  kbTag: string | null;       // default KB topic for AI answers on this number (null = tenant-wide KB)
  mode: "full" | "manual";    // "manual" = counselor line: no AI/flow/welcome/sequence/follow-up
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
    appId: (r.app_id as string | null) ?? null,
    agentId: (r.agent_id as string | null) ?? null,
    kbTag: (r.kb_tag as string | null) ?? null,
    mode: (r.mode as string) === "manual" ? "manual" : "full",
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
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.coex !== undefined ? { coex: input.coex } : {}),
    active: input.active ?? true,
    is_default: input.isDefault ?? false,
  };
  // Only one default at a time, per tenant.
  if (row.is_default) await db().from("wa_channels").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  const q = input.id
    ? db().from("wa_channels").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_channels").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapChannel(data as Record<string, unknown>);
}

// Save an Instagram channel (no phone/WABA; IG account id + page instead).
// Token is encrypted at rest and the row is scoped to the tenant.
export async function saveInstagramChannel(input: {
  id?: string; tenantId?: string; name: string; igUserId: string; pageId?: string | null;
  token: string; agentId?: string | null; kbTag?: string | null; active?: boolean; isDefault?: boolean;
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
  if (Number.isFinite(ls)) out.logoScale = Math.min(100, Math.max(30, ls));
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
