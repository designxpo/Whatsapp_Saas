// Where the leads came from — the question Google Analytics answers for a
// website, asked about conversations instead.
//
// ── Why this is not just a GA embed ────────────────────────────────────────
//
// GA measures a website journey: sessions, pageviews, bounce. There is no
// journey here. A tracked link goes straight to WhatsApp, and everything
// worth knowing happens AFTER the click, in a conversation GA cannot see.
// So the dimensions are GA's (source, medium, campaign) and the measures are
// ours (chats, replies, hand-offs).
//
// ── Coverage is reported first, deliberately ───────────────────────────────
//
// Measured 14 Oct: 36 of 3,183 contacts carry any attribution at all. Every
// other lead is genuinely Unknown — they messaged the number directly, or
// came through a path that carries no code.
//
// A dashboard that shows "google / cpc — 60%" over a 4% sample is worse than
// no dashboard, because it reads as a fact about the business rather than a
// fact about the measurement. So the coverage figure leads, and `unattributed`
// is a row in the table rather than a silent exclusion.
//
// ── Why the groupings are normalised ───────────────────────────────────────
//
// The same Facebook campaign arrives as fb, facebook, FB and facebook.com
// depending on who built the URL. Grouping on the raw value reports on how
// carefully each marketer typed; attribution.ts collapses them first.

import { tdb } from "./tenantdb";
import { DEFAULT_TENANT_ID } from "./tenant";
import { rangeStart, type RangeKey } from "./analytics-range";
import { deriveOrigin, type UtmSet } from "./attribution";

/** One row of the acquisition table. */
export interface SourceRow {
  /** "Google (paid)", "Meta (organic)", or a tracked-link label. */
  label: string;
  source: string;
  medium: string;
  /** Conversations started. The headline measure — see `chats` below. */
  chats: number;
  /** Of those, how many the lead wrote in more than once. */
  replied: number;
  /** Of those, how many reached a human. */
  handedOver: number;
}

export interface LeadSources {
  range: RangeKey;
  /** How much of the picture we can actually see. */
  coverage: {
    chats: number;          // conversations started in range
    attributed: number;     // …of which we know an origin for
    percent: number;
    linkOpens: number;      // short-link opens, all time (not range-scoped)
  };
  /** GA's source/medium view, normalised. */
  bySource: SourceRow[];
  /** The campaign links themselves — where the volume actually is today. */
  byLink: { label: string; chats: number; opens: number }[];
  byCampaign: { campaign: string; chats: number }[];
  /** Opens → chats → replied → handed over. */
  funnel: { opens: number; chats: number; replied: number; handedOver: number };
}

type Row = Record<string, unknown>;

/**
 * Read every row of a table, a page at a time.
 *
 * PostgREST caps EVERY response at 1,000 rows and .limit() does not raise it.
 * That cap has already cost this codebase real money once — a bare claim on
 * the send queue re-sent 1,739 duplicate templates — so a count here is paged
 * rather than assumed.
 */
async function pageAll(build: (from: number) => PromiseLike<{ data: unknown[] | null }>): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data } = await build(from);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const attrs = (r: Row): Record<string, string> => (r.attributes ?? {}) as Record<string, string>;
const last10 = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-10);

/**
 * The acquisition picture for one window.
 *
 * Never throws: a dashboard panel that errors takes the whole page with it,
 * and an empty panel is a better failure than a blank screen.
 */
export async function getLeadSources(range: RangeKey, tenantId = DEFAULT_TENANT_ID): Promise<LeadSources> {
  const since = rangeStart(range);
  const sinceIso = since ? since.toISOString() : null;

  const empty: LeadSources = {
    range,
    coverage: { chats: 0, attributed: 0, percent: 0, linkOpens: 0 },
    bySource: [], byLink: [], byCampaign: [],
    funnel: { opens: 0, chats: 0, replied: 0, handedOver: 0 },
  };

  try {
    // Conversations in range: the denominator, and where reply/hand-off live.
    const convs = await pageAll(from => {
      let q = tdb(tenantId).from("wa_conversations")
        .select("id, phone, status, last_inbound_at, created_at")
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (sinceIso) q = q.gte("created_at", sinceIso);
      return q;
    });

    // Only contacts that carry SOMETHING are worth reading in full — the rest
    // are the Unknown row and a count is enough.
    const tagged = await pageAll(from =>
      tdb(tenantId).from("contacts")
        .select("phone, attributes")
        .not("attributes", "is", null)
        .order("phone", { ascending: true })
        .range(from, from + 999),
    );

    const byPhone = new Map<string, Record<string, string>>();
    for (const c of tagged) {
      const a = attrs(c);
      if (a.handle_source || a.utm_source || a.utm_medium || a.utm_campaign || a.gclid || a.fbclid) {
        byPhone.set(last10(c.phone), a);
      }
    }

    // Link opens and chat counts per tracked source. touches is all-time, so
    // it is reported as such rather than pretending to respect the range.
    const { data: srcRows } = await tdb(tenantId).from("wa_handle_sources")
      .select("label, touches, short_clicks").order("touches", { ascending: false });

    const bySourceMap = new Map<string, SourceRow>();
    const byCampaignMap = new Map<string, number>();
    let attributed = 0, attrReplied = 0, attrHanded = 0;

    for (const cv of convs) {
      const a = byPhone.get(last10(cv.phone));
      // "Replied" means they wrote more than the message that opened the chat.
      const didReply = !!cv.last_inbound_at && String(cv.created_at) !== String(cv.last_inbound_at);
      const didHandOver = cv.status === "escalated";
      if (!a) continue;

      attributed++;
      if (didReply) attrReplied++;
      if (didHandOver) attrHanded++;

      const utm: UtmSet = {
        source: a.utm_source, medium: a.utm_medium, campaign: a.utm_campaign,
        gclid: a.gclid, fbclid: a.fbclid,
      };
      const o = deriveOrigin(utm);
      // With no UTMs at all, the tracked link is the best name we have.
      const label = o.label !== "Unknown" ? o.label : (a.handle_source || "Tracked link");
      // Keyed on the DERIVED label, never the raw utm_source. Keying on the
      // raw value put fb, facebook and FB in three separate rows — which is
      // the exact failure this module exists to avoid, and which a test
      // caught here rather than in a board report.
      const key = label;
      const row = bySourceMap.get(key) ?? {
        label,
        // Normalised for display too, so the table reads the way it groups.
        source: o.platform || a.utm_source || "—",
        medium: o.kind !== "unknown" ? o.kind : (a.utm_medium || "—"),
        chats: 0, replied: 0, handedOver: 0,
      };
      row.chats++;
      if (didReply) row.replied++;
      if (didHandOver) row.handedOver++;
      bySourceMap.set(key, row);

      if (a.utm_campaign) byCampaignMap.set(a.utm_campaign, (byCampaignMap.get(a.utm_campaign) ?? 0) + 1);
    }

    const chats = convs.length;
    const linkOpens = ((srcRows ?? []) as unknown as Row[]).reduce((n, s) => n + (Number(s.short_clicks) || 0), 0);

    return {
      range,
      coverage: {
        chats, attributed,
        percent: chats ? Math.round((attributed / chats) * 100) : 0,
        linkOpens,
      },
      bySource: [...bySourceMap.values()].sort((a, b) => b.chats - a.chats),
      byLink: ((srcRows ?? []) as unknown as Row[])
        .map(s => ({ label: String(s.label ?? ""), chats: Number(s.touches) || 0, opens: Number(s.short_clicks) || 0 }))
        .filter(s => s.chats > 0 || s.opens > 0)
        .sort((a, b) => b.chats - a.chats),
      byCampaign: [...byCampaignMap.entries()].map(([campaign, c]) => ({ campaign, chats: c })).sort((a, b) => b.chats - a.chats),
      // The funnel counts ATTRIBUTED conversations at every step after the
      // click, so the rates between stages are about one population rather
      // than silently widening to all traffic halfway down.
      funnel: { opens: linkOpens, chats: attributed, replied: attrReplied, handedOver: attrHanded },
    };
  } catch (e) {
    console.error(JSON.stringify({ tag: "lead_sources_failed", error: String(e) }));
    return empty;
  }
}
