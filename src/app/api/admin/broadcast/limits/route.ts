import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getCreds } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { dailySentCount } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET ?channelId= — today's send count vs the platform cap, plus the number's
// Meta messaging tier and quality rating. Meta fields degrade to an error
// string when the Graph API is unreachable (e.g. a Meta outage).
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const channelId = new URL(req.url).searchParams.get("channelId");
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const { token, phoneId } = getCreds(await credsFor(channelId, tid));

  const dailyCap = parseInt(process.env.WA_DAILY_LIMIT ?? "900", 10);
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
      } else {
        metaError = d?.error?.message || `HTTP ${r.status}`;
      }
    } catch (err) {
      metaError = err instanceof Error ? err.message : String(err);
    }
  } else {
    metaError = "WhatsApp credentials not configured";
  }

  return NextResponse.json({ dailyCap, sentToday, quality, tier, displayPhone, metaError });
}
