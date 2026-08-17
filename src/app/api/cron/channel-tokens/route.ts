export const maxDuration = 300;
import { NextResponse } from "next/server";
import { cronOk } from "@/lib/apiauth";
import { listChannels, updateChannelToken } from "@/lib/channels";
import { getTenantSetting, setTenantSetting } from "@/lib/store";
import { refreshIgToken, igTokenRefreshedKey } from "@/lib/iglogin";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Keep long-lived Instagram tokens alive.
//
// An Instagram long-lived token lasts 60 days. Nothing renewed them, so every
// Instagram channel this product has ever connected was on a timer: around two
// months in, Meta stops honouring the token, inbound goes quiet, sends fail
// with an OAuth error in a log nobody is reading, and the portal still shows a
// connected account. The tenant's experience is "it worked for a while and then
// it just stopped" — with no event to point at, because expiry is not an event.
//
// Refreshing early and often is the fix. Meta returns a fresh 60-day token on
// each refresh, so sweeping well inside the window means a token is never close
// to expiring, and a few missed runs (a GitHub Actions outage, a redeploy) cost
// nothing at all.
//
// Not a stage in /api/cron/process-queue: that route is deadline-bound around
// message delivery and would starve this, which is precisely the kind of work
// that must not be starved.

const REFRESH_AFTER_DAYS = 25;          // half the 60-day life — a month of slack
const DEADLINE = 240_000;               // leave headroom inside the 300s budget
const DAY_MS = 86_400_000;

export async function POST(req: Request) {
  if (!cronOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  const result = { checked: 0, refreshed: 0, skipped: 0, failed: 0, errors: [] as string[] };

  try {
    // Every tenant's Instagram channels. Inactive ones are skipped: a tenant who
    // switched a channel off should not have us holding its token alive.
    const channels = (await listChannels()).filter(c => c.kind === "instagram" && c.active && c.token);

    for (const ch of channels) {
      if (Date.now() - startedAt > DEADLINE) {
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

    return NextResponse.json({ ok: true, ...result, tookMs: Date.now() - startedAt });
  } catch (e) {
    console.error("[cron channel-tokens] sweep failed", e);
    return NextResponse.json({ ok: false, error: errorMessage(e), ...result }, { status: 500 });
  }
}
