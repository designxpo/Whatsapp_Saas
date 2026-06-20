import { NextResponse, after } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getCreds } from "@/lib/whatsapp";
import { credsFor, recordChannelQuality, tierDailyCap } from "@/lib/channels";
import { dailySentCount } from "@/lib/store";
import { getDailyCapForTier, safeCapFromTier, SAFETY_PCT } from "@/lib/quota";

export const dynamic = "force-dynamic";

// GET ?channelId= — today's send count vs the platform cap, plus the number's
// Meta messaging tier and quality rating. The platform cap is derived from the
// Meta tier (a safe fraction of it), so it tracks Meta automatically and stays
// conservatively below the ceiling. Meta fields degrade to an error string when
// the Graph API is unreachable (e.g. a Meta outage) — the cap then falls back.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const channelId = new URL(req.url).searchParams.get("channelId");
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const { token, phoneId } = getCreds(await credsFor(channelId, tid));

  const sentToday = await dailySentCount(tid).catch(() => 0);

  let quality: string | null = null, tier: string | null = null, displayPhone: string | null = null, metaError: string | null = null;
  if (token && phoneId) {
    try {
      const r = await fetch(`https://graph.facebook.com/v22.0/${phoneId}?fields=display_phone_number,quality_rating,messaging_limit_tier`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        quality = (d.quality_rating as string) ?? null;
        tier = (d.messaging_limit_tier as string) ?? null;
        displayPhone = (d.display_phone_number as string) ?? null;
        // Persist so the broadcast drainer's auto-pause + tier cap have fresh
        // data even if the quality webhook isn't subscribed. RED here pauses
        // marketing; the tier sizes the per-24h cap.
        if (channelId && (quality || tier)) after(() => recordChannelQuality({ phoneNumberId: phoneId }, { rating: quality, tier }));
      } else {
        metaError = d?.error?.message || `HTTP ${r.status}`;
      }
    } catch (err) {
      metaError = err instanceof Error ? err.message : String(err);
    }
  } else {
    metaError = "WhatsApp credentials not configured";
  }

  // The applied cap: a safe % of the Meta tier, else the env fallback. We also
  // surface the raw Meta ceiling + the safety % so the UI can explain the gap.
  const dailyCap = getDailyCapForTier(tier);
  const rawTier = tierDailyCap(tier);
  const metaTierCap = rawTier != null && Number.isFinite(rawTier) ? rawTier : null;
  const capSource = safeCapFromTier(tier) !== null ? "meta" : "fallback";

  return NextResponse.json({ dailyCap, sentToday, quality, tier, metaTierCap, safetyPct: SAFETY_PCT, capSource, displayPhone, metaError });
}
