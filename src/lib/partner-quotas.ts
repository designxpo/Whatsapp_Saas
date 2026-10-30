// White-label, Phase 6: caps on what Talko's SHARED quotas a partner can use.
// The YouTube Data API quota belongs to Talko's Google project and is shared
// by every workspace on the platform, so one partner's customers can't be
// allowed to drain it: all of a partner's workspaces together post at most
// the partner's yt_daily_cap replies a day (0 = no partner cap).
//
// Infinity (no limit beyond each workspace's own plan cap) for any workspace
// that isn't a partner's, and for everyone while white-label is off.

import { db } from "./supabase";
import { whiteLabelConfig } from "./whitelabel";

/** YouTube replies this workspace's partner may still post today (UTC day, like the per-workspace cap). */
export async function partnerYtRemaining(tenantId: string): Promise<number> {
  if (!whiteLabelConfig().enabled) return Number.POSITIVE_INFINITY;
  try {
    const { data: t } = await db().from("tenants").select("partner_id").eq("id", tenantId).maybeSingle();
    const pid = (t as { partner_id?: string | null } | null)?.partner_id;
    if (!pid) return Number.POSITIVE_INFINITY;
    const { data: p } = await db().from("wa_partners").select("yt_daily_cap").eq("id", pid).maybeSingle();
    const cap = Number((p as { yt_daily_cap?: number } | null)?.yt_daily_cap ?? 0);
    if (!(cap > 0)) return Number.POSITIVE_INFINITY;
    const { data: ids } = await db().from("tenants").select("id").eq("partner_id", pid);
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count } = await db().from("wa_yt_comment_log").select("*", { count: "exact", head: true })
      .in("tenant_id", ((ids ?? []) as { id: string }[]).map(r => r.id)).gte("created_at", since.toISOString());
    return Math.max(0, cap - (count ?? 0));
  } catch {
    // Before the partner migrations, or on a read error: fall back to each
    // workspace's own cap rather than blocking replies.
    return Number.POSITIVE_INFINITY;
  }
}
