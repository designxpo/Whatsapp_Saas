// AI follow-ups — re-engage a lead who went quiet. When WE sent the last message
// (often a question the customer never answered) and the chat has been silent for
// a configured delay, a cron-driven sweep composes ONE short, context-aware AI
// nudge (composeFollowup — grounding-firewalled, no new facts) and sends it on the
// chat's OWN channel. Critically it only fires INSIDE the 24h messaging window:
// free-form sends are blocked after it on WhatsApp/Instagram/Messenger (a top Meta
// ban trigger), so we never even try once the window has closed.
//
// Guardrails: stops the instant the lead replies (touchInbound resets the counter)
// or a human takes over (bot_enabled off / status paused), respects opt-outs, never
// fires more than the configured attempts per silent stretch, and yields the thread
// to any flow session or active drip that already owns it.
//
// Multi-tenant: the cron sweeps every tenant's conversations; each row carries its
// own tenant_id, and the nudge is composed with that tenant's AI provider. Tunables
// resolve per tenant (cached per run) with env fallbacks:
//   AI_FOLLOWUP_ENABLED        — env "false" is a GLOBAL kill switch for all tenants
//   wa_settings.followup_enabled       — per-tenant on/off (default on)
//   wa_settings.followup_delay_minutes — per-tenant quiet time before a nudge (env default 60)
//   wa_settings.followup_max_attempts  — per-tenant nudges per silent stretch (env default 1)

import { db } from "./supabase";
import { getChannel, type Channel } from "./channels";
import { getConvHistory, optoutSet, touchOutbound, appendConvMessage, getTenantSetting, type ConvPlatform } from "./store";
import { composeFollowup } from "./llm";
import { sendText } from "./whatsapp";
import { sendIgMessage } from "./instagram";
import { sendFbMessage } from "./messenger";
import { pushWaActivity } from "./leadsquared";
import { hasActiveEnrollment } from "./sequences";
import { isAiEnabled } from "./messaging-settings";
import { DEFAULT_TENANT_ID } from "./tenant";

// A margin under 24h so a send never RACES the window closing between this check
// and the actual API call (mirrors drainFlowReminders' 23.5h guard).
const SAFE_WINDOW_MS = 23.5 * 3600_000;
// SQL pre-filter floor: fetch chats quiet for ≥ this; the REAL per-tenant delay is
// enforced in JS (delays vary per tenant, so they can't live in one query).
const FLOOR_MINUTES = 5;
const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

interface FollowupCfg { enabled: boolean; delayMinutes: number; maxAttempts: number }

async function tenantCfg(tenantId: string, cache: Map<string, FollowupCfg>): Promise<FollowupCfg> {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const envDelay = Math.max(5, parseInt(process.env.AI_FOLLOWUP_DELAY_MINUTES ?? "", 10) || 60);
  const envMax   = Math.max(1, parseInt(process.env.AI_FOLLOWUP_MAX_ATTEMPTS  ?? "", 10) || 1);
  // Per-tenant opt-out model: enabled unless the tenant turned it off.
  const enabled = await getTenantSetting<boolean>(tenantId, "followup_enabled", true).catch(() => true);
  // Tenant-wide AI switch silences follow-ups too (they are AI-composed sends).
  const aiOn    = await isAiEnabled(tenantId).catch(() => true);
  const delay   = await getTenantSetting<number>(tenantId, "followup_delay_minutes", envDelay).catch(() => envDelay);
  const max     = await getTenantSetting<number>(tenantId, "followup_max_attempts", envMax).catch(() => envMax);
  const cfg: FollowupCfg = {
    enabled: enabled !== false && aiOn,
    delayMinutes: Math.max(5, Number(delay) || envDelay),
    maxAttempts: Math.max(1, Number(max) || envMax),
  };
  cache.set(tenantId, cfg);
  return cfg;
}

export async function drainAiFollowups(max = 50): Promise<number> {
  if (process.env.AI_FOLLOWUP_ENABLED === "false") return 0;   // global kill switch (all tenants)
  if (process.env.LLM_BOT_ENABLED === "false") return 0;

  const now = Date.now();
  const idleFloor   = new Date(now - FLOOR_MINUTES * 60_000).toISOString();   // quiet for ≥ floor (real delay checked per tenant)
  const windowStart = new Date(now - SAFE_WINDOW_MS).toISOString();           // last inbound still safely inside 24h

  // Candidates across all tenants: bot on, not paused, bot spoke last, quiet, the
  // customer's last inbound is still inside the window. Oldest-quiet first so the
  // most-due chats are processed before recently-nudged ones.
  const { data } = await db().from("wa_conversations").select("*")
    .in("status", ["active", "escalated"]).eq("bot_enabled", true)
    .not("last_outbound_at", "is", null).not("last_inbound_at", "is", null)
    .lte("last_outbound_at", idleFloor)
    .gte("last_inbound_at", windowStart)
    .order("last_outbound_at", { ascending: true }).limit(200);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return 0;

  // Conversations a flow is mid-way through — let flows + their own reminders own
  // those threads, never double-nudge them.
  const { data: fs } = await db().from("wa_flow_sessions").select("conversation_id").limit(1000);
  const inFlow = new Set((fs ?? []).map(r => (r as Record<string, unknown>).conversation_id as string));
  const cfgCache = new Map<string, FollowupCfg>();
  const optoutCache = new Map<string, Set<string>>();

  let sent = 0;
  for (const r of rows) {
    if (sent >= max) break;
    const id = r.id as string;
    const phone = r.phone as string;
    const tenantId = (r.tenant_id as string) ?? DEFAULT_TENANT_ID;
    const platform = (r.platform as ConvPlatform) ?? "whatsapp";
    const li = r.last_inbound_at as string | null;
    const lo = r.last_outbound_at as string | null;
    const origFu = (r.last_followup_at as string | null) ?? null;
    const attempts = (r.followup_count as number) ?? 0;

    // Genuinely awaiting THEIR reply: the bot's message is the most recent one.
    if (!phone || !li || !lo || new Date(li) >= new Date(lo)) continue;

    const cfg = await tenantCfg(tenantId, cfgCache);
    if (!cfg.enabled) continue;
    if (attempts >= cfg.maxAttempts) continue;
    // Space nudges by `delay` from the most recent of (our reply, our last nudge).
    // This also closes the race where a concurrent tick just claimed the row: it
    // stamped last_followup_at = now, so the anchor is now and we skip it here.
    const anchor = origFu && new Date(origFu) > new Date(lo) ? origFu : lo;
    if (now - new Date(anchor).getTime() < cfg.delayMinutes * 60_000) continue;

    if (platform === "whatsapp") {
      let oo = optoutCache.get(tenantId);
      if (!oo) { oo = await optoutSet(tenantId).catch(() => new Set<string>()); optoutCache.set(tenantId, oo); }
      if (oo.has(last10(phone))) continue;   // opt-out (WhatsApp is phone-keyed)
    }
    if (inFlow.has(id)) continue;                                                  // a flow owns this thread
    if (await hasActiveEnrollment(phone, tenantId).catch(() => false)) continue;   // a drip/inactivity sequence owns it

    // Atomic claim BEFORE the (slow) compose: compare-and-swap the attempt counter so
    // two overlapping cron ticks (the GitHub */5 pinger can overlap a slow run) can
    // NEVER double-send. Whoever still sees this exact count wins; the loser matches
    // nothing. A customer reply resets followup_count to 0 (touchInbound), so a stale
    // claim that lands after they replied also fails here. Scoped to the tenant.
    const claim = await db().from("wa_conversations")
      .update({ followup_count: attempts + 1, last_followup_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", id).eq("followup_count", attempts).eq("bot_enabled", true)
      .select("id");
    if (!claim.data?.length) continue;

    // release() undoes ONLY this tick's own claim: the followup_count == attempts+1
    // guard means that if the customer replied mid-compose (touchInbound reset the
    // count to 0), the predicate matches nothing and the reset is preserved.
    const release = () => db().from("wa_conversations")
      .update({ followup_count: attempts, last_followup_at: origFu })
      .eq("tenant_id", tenantId).eq("id", id).eq("followup_count", attempts + 1).then(() => {}, () => {});

    try {
      const channel: Channel | undefined = r.channel_id ? (await getChannel(r.channel_id as string, tenantId)) ?? undefined : undefined;
      const history = await getConvHistory(id, 16, tenantId);
      const nudge = await composeFollowup(history, { tenantId, agentName: channel?.name ?? null });
      // Nothing safe to say (no AI key / busy, or every claim stripped) — release so a
      // later tick can retry; don't burn an attempt on a no-op.
      if (!nudge?.text) { await release(); continue; }

      // composeFollowup is a slow model call — RE-CONFIRM the stop conditions
      // atomically before sending: proceed only if the customer hasn't replied
      // (last_inbound_at unchanged) AND no human took over (bot still on, not paused)
      // AND our claim still stands. A reply resets followup_count via touchInbound, so
      // the predicate then matches nothing and we skip the now-stale nudge. Tenant-scoped.
      const ok = await db().from("wa_conversations")
        .update({ last_followup_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", id).eq("bot_enabled", true).in("status", ["active", "escalated"])
        .eq("last_inbound_at", li).eq("followup_count", attempts + 1)
        .select("id");
      if (!ok.data?.length) { await release(); continue; }

      const res = await deliver(platform, phone, nudge.text, channel, li);
      if (!res.ok) { await release(); continue; }   // window slammed shut / API error → retry later

      await appendConvMessage({
        conversationId: id, role: "assistant", body: nudge.text, metaId: res.metaId, source: "bot", tenantId,
        groundingDeferred: nudge.groundingActions.some(a => a.disposition === "defer"),
        groundingStripped: nudge.groundingActions,
      }).catch(() => undefined);
      await touchOutbound(id, nudge.text).catch(() => undefined);
      if (platform === "whatsapp") void pushWaActivity({ phone, direction: "outbound", body: nudge.text, via: "bot", tenantId });
      sent++;
    } catch (e) {
      console.error("[followups] drain", id, e);
      await release();
    }
  }
  return sent;
}

// Send the nudge on the chat's own channel, passing the REAL lastInboundAt so each
// channel's 24h-window gate is honestly enforced (NOT now() like the flow senders,
// which run right after an inbound). Web-chat has no push API — the caller appends
// the assistant message and the widget's poll serves it on the next tick.
async function deliver(
  platform: ConvPlatform, phone: string, text: string, channel: Channel | undefined, lastInboundAt: string | null,
): Promise<{ ok: boolean; metaId?: string | null }> {
  if (platform === "whatsapp") {
    // sendText has NO window gate of its own, and the SQL windowStart snapshot can go
    // stale during a long tick — re-check at send time so a free-form WhatsApp message
    // can never be pushed past the window (mirrors flowengine.ts drainFlowReminders).
    if (!lastInboundAt || Date.now() - new Date(lastInboundAt).getTime() > SAFE_WINDOW_MS) return { ok: false };
    const r = await sendText(phone, text, channel);
    return { ok: !r.error, metaId: r.id };
  }
  if (platform === "instagram") {
    if (!channel?.igUserId) return { ok: false };
    const r = await sendIgMessage({ igUserId: channel.igUserId, token: channel.token }, phone, text, { lastInboundAt });
    return { ok: !!r.ok, metaId: r.messageId };
  }
  if (platform === "messenger") {
    if (!channel?.pageId) return { ok: false };
    const r = await sendFbMessage({ pageId: channel.pageId, token: channel.token }, phone, text, { lastInboundAt });
    return { ok: !!r.ok, metaId: r.messageId };
  }
  return { ok: true };   // webchat — delivery is the caller's appendConvMessage
}
