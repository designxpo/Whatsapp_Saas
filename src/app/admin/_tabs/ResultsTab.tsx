"use client";

// Results — what the conversations produced: paid orders and revenue by where
// customers came from, ads → leads → sales, broadcasts → orders, social
// comments → sales, how often the AI's "ready to pay" was right, and what's
// slipping. Attributed figures are labelled as such (results.ts).

import { useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { EmptyState, type GoTo, type Tab } from "../_shared";
import { DataPageHeader, DateRange, ExportCsvButton, LoadStatus } from "@/components/date-range";
import { presetOptions, presetByKey, presetForDays, type PresetKey } from "@/lib/analytics-range";
import { csvFileName, csvRupees, downloadCsv, toCsvSections, type CsvSection } from "@/lib/csv-export";
import { fmtInr, fmtNum } from "@/lib/format";
import { openTab } from "@/lib/open-tab";

export type ResultsReport = {
  days: number; revenueCents: number; paidOrders: number; currency: string;
  bySource: { channel: string; orders: number; revenueCents: number; fromCustomerRecord: number }[];
  ads: { adId: string; name: string; leads: number; qualified: number; paidCustomers: number; revenueCents: number }[];
  broadcasts: { campaignId: string; name: string; reached: number; buyers: number; revenueCents: number }[];
  social: { platform: string; invites: number; chats: number; orders: number; revenueCents: number }[];
  aiReads: { readyToPay: number; paidWithin14Days: number; notReadyButPaid: number } | null;
  missed: { readyNotPaid: number; unpaidOrders: number; unpaidValueCents: number };
};

const PLATFORM: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
/** The windows /api/admin/results answers (it accepts 7, 30 or 90 days). */
const RANGE_OPTIONS = presetOptions(["7d", "30d", "90d"]);

/** Every table on the screen, as spreadsheet sections. Money in rupees as plain numbers. Pure. */
export function resultsCsvSections(r: ResultsReport): CsvSection[] {
  const cur = r.currency || "INR";
  const sections: CsvSection[] = [
    { title: `Summary — last ${r.days} days`, header: ["Measure", "Value"], rows: [
      [`Revenue (${cur})`, csvRupees(r.revenueCents)],
      ["Paid orders", r.paidOrders],
      [`Average order (${cur})`, r.paidOrders ? csvRupees(r.revenueCents / r.paidOrders) : null],
      ["Orders unpaid for over a day", r.missed.unpaidOrders],
      [`Value of unpaid orders (${cur})`, csvRupees(r.missed.unpaidValueCents)],
      ["Leads ready to pay who haven't paid", r.missed.readyNotPaid],
    ] },
    { title: "Where paying customers came from", header: ["Source", "Paid orders", `Revenue (${cur})`], rows: r.bySource.map(s => [s.channel, s.orders, csvRupees(s.revenueCents)]) },
    { title: "Meta ads to leads to sales", header: ["Ad", "Leads", "Qualified", "Paid customers", `Revenue (${cur})`], rows: r.ads.map(a => [a.name, a.leads, a.qualified, a.paidCustomers, csvRupees(a.revenueCents)]) },
    { title: "Broadcasts to orders (bought within 7 days)", header: ["Broadcast", "Reached", "Bought within 7 days", `Revenue (${cur})`], rows: r.broadcasts.map(b => [b.name, b.reached, b.buyers, csvRupees(b.revenueCents)]) },
    { title: "Social comments to WhatsApp to sales", header: ["Channel", "Invited", "Chats started", "Orders", `Revenue (${cur})`], rows: r.social.map(s => [PLATFORM[s.platform] ?? s.platform, s.invites, s.chats, s.orders, csvRupees(s.revenueCents)]) },
  ];
  if (r.aiReads) sections.push({ title: "Was the AI right?", header: ["Measure", "Leads"], rows: [
    ["Read as ready to pay", r.aiReads.readyToPay],
    ["Of those, paid within 14 days", r.aiReads.paidWithin14Days],
    ["Read as cold or lost, but paid", r.aiReads.notReadyButPaid],
  ] });
  return sections;
}

export default function ResultsTab({ goTo }: { goTo?: GoTo } = {}) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<ResultsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Keep the last period on screen (dimmed) while the new one adds up.
    let active = true;
    setLoading(true); setErr(null);
    fetch(`/api/admin/results?days=${days}`).then(async res => {
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (active) { setR(j); setUpdatedAt(Date.now()); }
    }).catch(e => { if (active) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days]);

  const money = (c: number) => (!r?.currency || r.currency === "INR"
    ? fmtInr(c / 100)
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: r.currency, maximumFractionDigits: 0 }).format(c / 100));
  const go = (t: Tab) => openTab(t, goTo);
  const action = (label: string, t: Tab) => (
    <button type="button" onClick={() => go(t)} className="min-h-9 rounded-control border border-line bg-white px-4 text-[13px] font-semibold text-brand-800 hover:bg-brand-50">{label}</button>
  );

  function exportCsv() {
    if (!r) return;
    downloadCsv(csvFileName(["results", `last ${r.days} days`]), toCsvSections(resultsCsvSections(r)));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <DataPageHeader
        icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        title="Results"
        subtitle="What your conversations turned into — paid orders, and where those customers came from."
        status={<LoadStatus loading={loading && !!r} updatedAt={updatedAt} className="mt-1" />}
        controls={<>
          <DateRange options={RANGE_OPTIONS} value={(presetForDays(days, ["7d", "30d", "90d"])?.key ?? "30d") as PresetKey} onChange={k => setDays(presetByKey(k)?.days ?? 30)} />
          <ExportCsvButton onClick={exportCsv} disabled={!r} />
        </>}
      />

      {err && <div role="alert" className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>}
      {!r && !err && <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Adding it up…</div>}

      {r && (
        <div aria-busy={loading} className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Revenue" value={money(r.revenueCents)} />
            <Tile label="Paid orders" value={fmtNum(r.paidOrders)} />
            <Tile label="Average order" value={r.paidOrders ? money(r.revenueCents / r.paidOrders) : "—"} />
            <Tile label="Unpaid for over a day" value={r.missed.unpaidOrders ? `${fmtNum(r.missed.unpaidOrders)} · ${money(r.missed.unpaidValueCents)}` : "0"} tone={r.missed.unpaidOrders ? "warn" : undefined} />
          </div>

          <Section title="Where paying customers came from" note={r.bySource.some(s => s.fromCustomerRecord) ? "Orders placed before sources were saved use the customer's current record." : undefined}>
            {!r.bySource.length ? (
              <EmptyState title="No paid orders in this period yet"
                body="An order counts here once the customer pays — through a payment link sent in the chat, or when you mark the order as paid."
                action={action("Set up payment in chat", "catalog")} />
            ) : (
              <Table head={["Source", "Paid orders", "Revenue", "Share"]}>
                {r.bySource.map(s => <tr key={s.channel}><Td strong>{s.channel}</Td><Td>{fmtNum(s.orders)}</Td><Td>{money(s.revenueCents)}</Td><Td>{pct(s.revenueCents, r.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Meta ads → leads → sales" note="Leads are customers whose first message came from a Click-to-WhatsApp ad in this period. Qualified means the AI read them as hot, ready to pay, or they bought.">
            {!r.ads.length ? (
              <EmptyState title="No customers came from Click-to-WhatsApp ads in this period"
                body="When someone taps a Facebook or Instagram ad that opens a WhatsApp chat, they're counted here — with what they went on to buy."
                action={action("Go to Meta Ads", "ads")} />
            ) : (
              <Table head={["Ad", "Leads", "Qualified", "Paid", "Revenue"]}>
                {r.ads.map(a => <tr key={a.adId}><Td strong>{a.name}</Td><Td>{fmtNum(a.leads)}</Td><Td>{fmtNum(a.qualified)} <span className="text-ink-500">({pct(a.qualified, a.leads)})</span></Td><Td>{fmtNum(a.paidCustomers)}</Td><Td>{money(a.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Broadcasts → orders" note="Likely, not proven: orders from people who received the broadcast, placed within 7 days of it.">
            {!r.broadcasts.length ? (
              <EmptyState title="No broadcasts were sent in this period"
                body="After you send a broadcast, orders its recipients place within 7 days show here."
                action={action("Send a broadcast", "broadcast")} />
            ) : (
              <Table head={["Broadcast", "Reached", "Bought within 7 days", "Revenue"]}>
                {r.broadcasts.map(b => <tr key={b.campaignId}><Td strong>{b.name}</Td><Td>{fmtNum(b.reached)}</Td><Td>{fmtNum(b.buyers)} <span className="text-ink-500">({pct(b.buyers, b.reached)})</span></Td><Td>{money(b.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Social comments → WhatsApp → sales" note="Comment replies that invited people to continue on WhatsApp, and what those chats bought.">
            {!r.social.length ? (
              <EmptyState title="No comment invitations in this period"
                body="Turn on “Continue on WhatsApp” in an Instagram, Facebook or YouTube comment rule. Each person it invites, and what they buy, is counted here."
                action={action("Set up Instagram comment replies", "instagram")} />
            ) : (
              <Table head={["Channel", "Invited", "Chats started", "Orders", "Revenue"]}>
                {r.social.map(s => <tr key={s.platform}><Td strong>{PLATFORM[s.platform] ?? s.platform}</Td><Td>{fmtNum(s.invites)}</Td><Td>{fmtNum(s.chats)} <span className="text-ink-500">({pct(s.chats, s.invites)})</span></Td><Td>{fmtNum(s.orders)}</Td><Td>{money(s.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Was the AI right?" note="Based on the AI's read of each lead, recorded from now on.">
            {!r.aiReads || !r.aiReads.readyToPay ? (
              <EmptyState title="No leads were read as ready to pay in this period yet"
                body="The AI reads each chat and marks people who are ready to pay. Once some of them buy (or don't), you'll see how often it was right."
                action={action("Open Live Chat", "livechat")} />
            ) : (
              <p className="px-4 py-3 text-sm text-ink-800">
                The AI said <b>{fmtNum(r.aiReads.readyToPay)}</b> lead{r.aiReads.readyToPay === 1 ? " was" : "s were"} ready to pay. <b>{fmtNum(r.aiReads.paidWithin14Days)}</b> paid within 14 days ({pct(r.aiReads.paidWithin14Days, r.aiReads.readyToPay)}).
                {r.aiReads.notReadyButPaid > 0 && <> {fmtNum(r.aiReads.notReadyButPaid)} lead{r.aiReads.notReadyButPaid === 1 ? "" : "s"} it read as cold or lost paid anyway.</>}
              </p>
            )}
          </Section>

          {r.missed.readyNotPaid > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="flex-1 min-w-[200px]"><b>{fmtNum(r.missed.readyNotPaid)}</b> lead{r.missed.readyNotPaid === 1 ? " was" : "s were"} ready to pay in this period but haven&apos;t paid. They&apos;re in Today until someone follows up.</p>
              <button type="button" onClick={() => go("today")} className="min-h-9 rounded-control border border-amber-300 bg-white px-3 text-[13px] font-semibold text-amber-900 hover:bg-amber-100">Open Today</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-card border border-line bg-white p-3">
      <p className="text-[12px] font-semibold text-ink-600">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone === "warn" ? "text-amber-800" : "text-ink-900"}`}>{value}</p>
    </div>
  );
}
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-bold text-ink-900">{title}</h2>
        {note && <p className="text-[12px] text-ink-600">{note}</p>}
      </div>
      {children}
    </section>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead className="bg-canvas"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-4 py-2 text-[12px] font-semibold text-ink-600 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`px-4 py-2 ${strong ? "text-left font-semibold text-ink-900" : "text-right text-ink-700"}`}>{children}</td>;
}
