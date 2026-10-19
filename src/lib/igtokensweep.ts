// Keep long-lived Instagram tokens alive.
//
// An Instagram long-lived token lasts 60 days. Nothing renewed them, so every
// Instagram channel this product has ever connected was on a timer: around two
// months in, Meta stops honouring the token, inbound goes quiet, sends fail
// with an OAuth error in a log nobody is reading, and the portal still shows a
// connected account.
//
// Refreshing early and often is the fix. Meta returns a fresh 60-day token on
// each refresh, so sweeping well inside the window means a token is never close
// to expiring, and a few missed runs cost nothing at all.
//
// Two callers: /api/cron/channel-tokens (the GitHub Actions daily job) and the
// main engine, which runs this after its response every few hours. The second
// exists because the GitHub job authenticates with its own copy of CRON_SECRET,
// and when that copy went stale on 2026-10-03 the sweep silently stopped. The
// engine is driven by pg_cron, which carries the live secret.

import { listChannels, updateChannelToken } from "./channels";
import { getTenantSetting, setTenantSetting } from "./store";
import { refreshIgToken, igTokenRefreshedKey } from "./iglogin";
import { errorMessage } from "./errors";

const REFRESH_AFTER_DAYS = 25;          // half the 60-day life — a month of slack
const DAY_MS = 86_400_000;

export interface TokenSweepResult { checked: number; refreshed: number; skipped: number; failed: number; errors: string[] }

/** Refresh every active Instagram token older than REFRESH_AFTER_DAYS. Throws only if listing channels fails. */
export async function sweepInstagramTokens(deadlineAt: number): Promise<TokenSweepResult> {
  const result: TokenSweepResult = { checked: 0, refreshed: 0, skipped: 0, failed: 0, errors: [] };
  // Every tenant's Instagram channels. Inactive ones are skipped: a tenant who
  // switched a channel off should not have us holding its token alive.
  const channels = (await listChannels()).filter(c => c.kind === "instagram" && c.active && c.token);

  for (const ch of channels) {
    if (Date.now() > deadlineAt) {
      console.warn("[cron channel-tokens] deadline reached — remaining channels roll to the next run", { remaining: channels.length - result.checked });
      break;
    }
    result.checked++;

    // No stamp yet → fall back to when the channel was connected, so accounts
    // that predate this sweep are treated by their real age rather than as
    // brand new (which would leave them to expire untouched).
    const last = await getTenantSetting<string | null>(ch.tenantId, igTokenRefreshedKey(ch.id), null).catch(() => null);
    const since = Date.parse(last ?? ch.createdAt ?? "");
    const ageDays = Number.isFinite(since) ? (Date.now() - since) / DAY_MS : Infinity;
    if (ageDays < REFRESH_AFTER_DAYS) { result.skipped++; continue; }

    const r = await refreshIgToken(ch.token);
    if (!r.ok || !r.token) {
      result.failed++;
      // Worth an error line each time: a token that can no longer be refreshed
      // is already dead or revoked, and that account needs reconnecting.
      console.error("[cron channel-tokens] refresh failed — this account will stop working and needs reconnecting", {
        channelId: ch.id, tenantId: ch.tenantId, name: ch.name, error: r.error,
      });
      result.errors.push(`${ch.name}: ${r.error}`);
      continue;
    }

    try {
      await updateChannelToken(ch.id, r.token);
      // Stamp only after the token is safely stored. Stamping first would mean
      // a failed write silently pushes the next attempt out by another 25 days.
      await setTenantSetting(ch.tenantId, igTokenRefreshedKey(ch.id), new Date().toISOString());
      result.refreshed++;
      console.log("[cron channel-tokens] refreshed", { channelId: ch.id, tenantId: ch.tenantId, expiresInDays: r.expiresIn ? Math.round(r.expiresIn / 86_400) : null });
    } catch (e) {
      result.failed++;
      console.error("[cron channel-tokens] could not store refreshed token", { channelId: ch.id, error: errorMessage(e) });
      result.errors.push(`${ch.name}: could not store refreshed token`);
    }
  }
  return result;
}
