// Where a customer came from, in words an owner recognises — read from the
// attribution the app already stores on a contact: a Click-to-WhatsApp ad
// (ad_id/ad_headline), UTM tags and ad click ids from a tracked link
// (attribution.ts, sessionrefs), a Links & QR source (handle_source), or the
// opt-in source. Saved on each order at checkout so Results can count paying
// customers by source even after the contact's attributes change.

import { tdb } from "./tenantdb";

export interface OrderSource { channel: string; detail: string | null; adId?: string | null; campaign?: string | null }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

/** Pure: a contact's attributes (and opt-in source) → where they came from. */
export function sourceFromAttributes(attrs: Record<string, unknown> | null | undefined, optInSource?: string | null): OrderSource {
  const a = attrs ?? {};
  if (str(a.ad_id)) return { channel: "Meta ad", detail: str(a.ad_headline) ?? `Ad ${str(a.ad_id)}`, adId: str(a.ad_id), campaign: str(a.utm_campaign) };
  if (str(a.utm_source)) {
    const medium = str(a.utm_medium);
    const paid = medium && /cpc|ppc|paid/i.test(medium);
    return { channel: paid ? "Paid search / ads" : "Website & campaigns", detail: [str(a.utm_source), medium].filter(Boolean).join(" / "), campaign: str(a.utm_campaign) };
  }
  if (str(a.gclid)) return { channel: "Paid search / ads", detail: "Google Ads click", campaign: null };
  if (str(a.fbclid)) return { channel: "Facebook or Instagram link", detail: null, campaign: null };
  if (str(a.handle_source)) return { channel: "Links & QR codes", detail: str(a.handle_source), campaign: null };
  const opt = str(optInSource);
  if (opt && opt !== "inbound" && opt !== "legacy") return { channel: opt === "growth" ? "Growth tools" : opt.startsWith("import") ? "Imported contacts" : "Other", detail: opt, campaign: null };
  return { channel: "Direct / unknown", detail: null, campaign: null };
}

/** The source for a phone's contact in this workspace (Direct / unknown if none). */
export async function sourceForPhone(tenantId: string, phone: string): Promise<OrderSource> {
  const { data } = await tdb(tenantId).from("contacts").select("attributes,opt_in_source").eq("phone", phone).maybeSingle();
  const c = data as unknown as { attributes: Record<string, unknown> | null; opt_in_source: string | null } | null;
  return sourceFromAttributes(c?.attributes, c?.opt_in_source);
}
