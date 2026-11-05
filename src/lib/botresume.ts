// Turning a chat's bot back on once the team has gone quiet.
//
// A person replying in a chat turns its bot off, and only a person pressing
// "Turn bot on" turned it back on, so a chat handed to someone who then moved
// on stayed silent for good. Now, once nothing has been sent in the chat and
// the bot has been off for the workspace's set time, it comes back on. ON by
// default (12 hours); Settings → Automatic messages changes or stops it.
//
// A resumed bot only answers. AI follow-ups and inactivity drips skip the chat
// until the customer writes again (resumedQuiet), so waking old chats can
// never message past leads. Personal (manual-mode) numbers are left alone.
// Every read and write is filtered by the workspace's id.

import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getTenantSetting, setTenantSetting, tenantIdsWithSetting } from "./store";
import { listChannels } from "./channels";
import { logActivity } from "./team";

const SETTING_KEY = "bot_auto_resume";
const LAST_KEY = "bot_auto_resume_last";
const MAX_PER_RUN = 200;
const MAX_TENANTS_PER_TICK = 25;

export interface BotResumeSetting { enabled: boolean; afterHours: number }
export const BOT_RESUME_DEFAULTS: BotResumeSetting = { enabled: true, afterHours: 12 };
export const MIN_HOURS = 1;
export const MAX_HOURS = 168;

/** A usable whole number of hours, or the default. Zero or junk never means "immediately". */
export function clampHours(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < MIN_HOURS) return BOT_RESUME_DEFAULTS.afterHours;
  return Math.min(MAX_HOURS, n);
}

export async function getBotResume(tenantId: string): Promise<BotResumeSetting> {
  const s = await getTenantSetting<Partial<BotResumeSetting>>(tenantId, SETTING_KEY, {});
  return { enabled: s.enabled !== false, afterHours: clampHours(s.afterHours ?? BOT_RESUME_DEFAULTS.afterHours) };
}

export async function setBotResume(tenantId: string, v: Partial<BotResumeSetting>): Promise<BotResumeSetting> {
  const next = { enabled: v.enabled !== false, afterHours: clampHours(v.afterHours) };
  await setTenantSetting(tenantId, SETTING_KEY, next);
  return next;
}

/** Pure: should this bot-off chat come back on now? Undated chats are never touched. */
export function isDue(c: { bot_off_at: string | null; last_outbound_at: string | null; channel_id: string | null }, cutoffMs: number, manualChannels: Set<string>): boolean {
  if (!c.bot_off_at) return false;
  if (c.channel_id && manualChannels.has(c.channel_id)) return false;
  const off = Date.parse(c.bot_off_at);
  if (!Number.isFinite(off) || off > cutoffMs) return false;
  if (c.last_outbound_at) {
    const out = Date.parse(c.last_outbound_at);
    if (!Number.isFinite(out) || out > cutoffMs) return false;
  }
  return true;
}

/** Pure: the bot came back by itself and the customer hasn't written since. */
export function resumedQuiet(c: { bot_resumed_at?: string | null; last_inbound_at?: string | null }): boolean {
  if (!c.bot_resumed_at) return false;
  if (!c.last_inbound_at) return true;
  return Date.parse(c.last_inbound_at) <= Date.parse(c.bot_resumed_at);
}

async function manualChannelIds(tenantId: string): Promise<Set<string>> {
  const chans = await listChannels(tenantId).catch(() => []);
  return new Set(chans.filter(c => c.mode === "manual").map(c => c.id));
}

type Row = { id: string; phone: string | null; bot_off_at: string | null; last_outbound_at: string | null; channel_id: string | null };

// Filtered in the query, so personal-line or still-active chats can't fill the
// capped read and hide the ones that are due.
async function candidates(tenantId: string, cutoffIso: string, manual: Set<string>): Promise<Row[]> {
  let q = tdb(tenantId).from("wa_conversations")
    .select("id, phone, bot_off_at, last_outbound_at, channel_id")
    .eq("bot_enabled", false)
    .lte("bot_off_at", cutoffIso)
    .or(`last_outbound_at.is.null,last_outbound_at.lte.${cutoffIso}`);
  if (manual.size) q = q.or(`channel_id.is.null,channel_id.not.in.(${[...manual].join(",")})`);
  const { data, error } = await q.order("bot_off_at", { ascending: true }).limit(MAX_PER_RUN);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

export interface BotResumeStatus extends BotResumeSetting {
  available: boolean;
  botOff: number | null;
  dueNow: number | null;
  lastRun: { at: string; resumed: number } | null;
}

export async function botResumeStatus(tenantId: string, now = Date.now()): Promise<BotResumeStatus> {
  const cfg = await getBotResume(tenantId);
  const lastRun = await getTenantSetting<{ at: string; resumed: number } | null>(tenantId, LAST_KEY, null);
  try {
    const cutoff = now - cfg.afterHours * 3_600_000;
    const manual = await manualChannelIds(tenantId);
    const [rows, off] = await Promise.all([
      candidates(tenantId, new Date(cutoff).toISOString(), manual),
      tdb(tenantId).from("wa_conversations").select("id", { count: "exact", head: true }).eq("bot_enabled", false),
    ]);
    return { ...cfg, available: true, botOff: off.count ?? null, dueNow: rows.filter(r => isDue(r, cutoff, manual)).length, lastRun };
  } catch {
    return { ...cfg, available: false, botOff: null, dueNow: null, lastRun };
  }
}

/** One workspace, one pass. */
export async function resumeTenantBots(tenantId: string, now = Date.now()): Promise<{ resumed: number; reason?: string }> {
  const cfg = await getBotResume(tenantId);
  if (!cfg.enabled) return { resumed: 0, reason: "disabled" };
  const cutoff = now - cfg.afterHours * 3_600_000;
  const cutoffIso = new Date(cutoff).toISOString();
  const manual = await manualChannelIds(tenantId);
  let rows: Row[];
  try { rows = await candidates(tenantId, cutoffIso, manual); }
  catch { return { resumed: 0, reason: "unavailable" }; }   // before the migration: nothing to do
  const due = rows.filter(r => isDue(r, cutoff, manual));
  if (!due.length) return { resumed: 0 };

  // Conditional on the bot still being off: a person who turned it on in the
  // meantime is not overwritten.
  const { data, error } = await tdb(tenantId).from("wa_conversations")
    .update({ bot_enabled: true, bot_resumed_at: new Date(now).toISOString() })
    .in("id", due.map(r => r.id))
    .eq("bot_enabled", false)
    .lte("bot_off_at", cutoffIso)
    .select("id");
  if (error) return { resumed: 0, reason: "update failed" };
  const resumed = (data ?? []).length;
  if (resumed) {
    await setTenantSetting(tenantId, LAST_KEY, { at: new Date(now).toISOString(), resumed }).catch(() => {});
    logActivity({ email: "automatic", name: "Bot auto-resume", tenantId }, "inbox.bot_auto_resume",
      `bot back on in ${resumed} chat(s) after ${cfg.afterHours}h with no reply from the team`);
  }
  return { resumed };
}

/**
 * Every workspace with bot-off chats old enough to possibly be due, except
 * those that switched this off. On by default, so it can't list "workspaces
 * that turned it on"; it looks for the work instead.
 */
export async function drainBotResumes(now = Date.now()): Promise<{ tenants: number; resumed: number }> {
  const off = await tenantIdsWithSetting(SETTING_KEY, v => (v as { enabled?: unknown } | null)?.enabled === false).catch(() => [] as string[]);
  const floor = new Date(now - MIN_HOURS * 3_600_000).toISOString();
  let q = db().from("wa_conversations").select("tenant_id")
    .eq("bot_enabled", false).lte("bot_off_at", floor);
  if (off.length) q = q.not("tenant_id", "in", `(${off.join(",")})`);
  const { data, error } = await q.order("bot_off_at", { ascending: true }).limit(1000);
  if (error || !data?.length) return { tenants: 0, resumed: 0 };
  const ids = [...new Set((data as { tenant_id: string | null }[]).map(r => r.tenant_id).filter((t): t is string => !!t))];
  const { data: live } = await db().from("tenants").select("id").in("id", ids).in("status", ["trialing", "active"]);
  let tenants = 0, resumed = 0;
  for (const t of (live ?? []).slice(0, MAX_TENANTS_PER_TICK)) {
    const tenantId = (t as { id: string }).id;
    try {
      const r = await resumeTenantBots(tenantId, now);
      if (r.resumed) { tenants++; resumed += r.resumed; }
    } catch (e) { console.error("[botresume]", tenantId, e); }
  }
  return { tenants, resumed };
}
