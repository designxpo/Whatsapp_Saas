import { NextResponse } from "next/server";
import { currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import {
  getRequestConfig, saveRequestConfig, requestStats, sendNow, fillReviewUrlFromGoogle, resolveReviewUrl,
  requestMessage, templateValues, type RequestConfig,
} from "@/lib/review-booster";
import { listChannels, isLiveChannel } from "@/lib/channels";
import { getGoogleSyncStatus } from "@/lib/reviews";
import { fetchTemplates } from "@/lib/whatsapp";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Events a connected tool sends that mean "the service was completed / paid".
const EVENT_SUGGESTIONS = [
  { key: "mezmitra.bill.paid", label: "Mezvaan — a bill is paid" },
  { key: "woocommerce.order_completed", label: "WooCommerce — order completed" },
  { key: "shopify.order_paid", label: "Shopify — order paid" },
  { key: "razorpay.payment_captured", label: "Razorpay — payment received" },
  { key: "razorpay.payment_link_paid", label: "Razorpay — payment link paid" },
];

async function gate() {
  if (!(await requireRoleAdmin())) return { res: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  const tid = await currentTenantId();
  if (!tid) return { res: NextResponse.json({ error: "Workspace required" }, { status: 401 }) };
  const g = await guardFeature(tid, "reviews");
  return g ? { res: g } : { tid };
}

// GET — review request settings, the last 30 days, the connected locations and
// the WhatsApp templates that can carry the review link.
export async function GET() {
  const g = await gate();
  if (g.res) return g.res;
  const tid = g.tid!;
  try {
    const [config, stats, channels, sync] = await Promise.all([getRequestConfig(tid), requestStats(tid), listChannels(tid), getGoogleSyncStatus(tid)]);
    const locations = channels.filter(c => c.kind === "google_reviews" && c.active && c.googleLocationId).map(c => ({ id: c.id, name: c.name, reviewUri: sync[c.id]?.reviewUri ?? null }));
    const wa = channels.filter(c => c.kind === "whatsapp" && isLiveChannel(c));
    const sender = wa.find(c => c.isDefault) ?? wa[0];
    const all = sender ? await fetchTemplates(sender).catch(() => []) : [];
    const templates = all.filter(t => t.status === "APPROVED").map(t => {
      const v = templateValues(t, "https://example.invalid/r/rv/x", "x");
      return { name: t.name, language: t.language, category: t.category, usable: !("error" in v), why: "error" in v ? v.error : null };
    });
    return NextResponse.json({
      config, stats, locations, templates, whatsappConnected: !!sender, eventSuggestions: EVENT_SUGGESTIONS,
      reviewUrl: await resolveReviewUrl(tid, config),
      preview: requestMessage(config.message, "https://app.thetalko.in/r/rv/…"),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { action: "save", config } — save settings (switching off cancels what's waiting);
//      { action: "send", phone, name? } — ask one customer now, with every check;
//      { action: "fill", locationId? } — use a connected location's own review link.
export async function POST(req: Request) {
  const g = await gate();
  if (g.res) return g.res;
  const tid = g.tid!;
  const body = await req.json().catch(() => ({})) as { action?: string; config?: Partial<RequestConfig>; phone?: string; name?: string; locationId?: string };
  try {
    if (body.action === "send") return NextResponse.json(await sendNow(tid, String(body.phone ?? ""), body.name ?? null));
    if (body.action === "fill") {
      const r = await fillReviewUrlFromGoogle(tid, body.locationId ?? null);
      return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
    }
    const r = await saveRequestConfig(tid, body.config ?? {});
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
