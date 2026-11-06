"use client";

// Results — what the conversations produced: paid orders and revenue by where
// customers came from, ads → leads → sales, broadcasts → orders, social
// comments → sales, how often the AI's "ready to pay" was right, and what's
// slipping. Attributed figures are labelled as such (results.ts).

import { useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";

type R = {
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

export default function ResultsTab() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setR(null); setErr(null);
    fetch(`/api/admin/results?days=${days}`).then(async res => {
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setR(j);
    }).catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [days]);

  const money = (c: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: r?.currency || "INR", maximumFractionDigits: 0 }).format(c / 100);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-ink-900"><TrendingUp className="h-5 w-5" /> Results</h1>
          <p className="text-sm text-ink-600">What your conversations turned into — paid orders, and where those customers came from.</p>
        </div>
        <div role="tablist" aria-label="Period" className="inline-flex rounded-control border border-line bg-white p-0.5">
          {[7, 30, 90].map(d => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}
              className={`rounded-control px-3 py-1.5 text-xs font-bold ${days === d ? "bg-brand-700 text-white" : "text-ink-600 hover:bg-canvas"}`}>Last {d} days</button>
          ))}
        </div>
      </header>

      {err && <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {!r && !err && <div className="flex items-center gap-2 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Adding it up…</div>}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Revenue" value={money(r.revenueCents)} />
            <Tile label="Paid orders" value={String(r.paidOrders)} />
            <Tile label="Average order" value={r.paidOrders ? money(r.revenueCents / r.paidOrders) : "—"} />
            <Tile label="Unpaid for over a day" value={r.missed.unpaidOrders ? `${r.missed.unpaidOrders} · ${money(r.missed.unpaidValueCents)}` : "0"} tone={r.missed.unpaidOrders ? "warn" : undefined} />
          </div>

          <Section title="Where paying customers came from" note={r.bySource.some(s => s.fromCustomerRecord) ? "Orders placed before sources were saved use the customer's current record." : undefined}>
            {!r.bySource.length ? <Empty>No paid orders in this period yet.</Empty> : (
              <Table head={["Source", "Paid orders", "Revenue", "Share"]}>
                {r.bySource.map(s => <tr key={s.channel}><Td strong>{s.channel}</Td><Td>{s.orders}</Td><Td>{money(s.revenueCents)}</Td><Td>{pct(s.revenueCents, r.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Meta ads → leads → sales" note="Leads are customers whose first message came from a Click-to-WhatsApp ad in this period. Qualified means the AI read them as hot, ready to pay, or they bought.">
            {!r.ads.length ? <Empty>No customers came from Click-to-WhatsApp ads in this period.</Empty> : (
              <Table head={["Ad", "Leads", "Qualified", "Paid", "Revenue"]}>
                {r.ads.map(a => <tr key={a.adId}><Td strong>{a.name}</Td><Td>{a.leads}</Td><Td>{a.qualified} <span className="text-ink-400">({pct(a.qualified, a.leads)})</span></Td><Td>{a.paidCustomers}</Td><Td>{money(a.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Broadcasts → orders" note="Attributed, not proven: orders from people who received the broadcast, placed within 7 days of it.">
            {!r.broadcasts.length ? <Empty>No broadcasts were sent in this period.</Empty> : (
              <Table head={["Broadcast", "Reached", "Bought within 7 days", "Revenue"]}>
                {r.broadcasts.map(b => <tr key={b.campaignId}><Td strong>{b.name}</Td><Td>{b.reached}</Td><Td>{b.buyers} <span className="text-ink-400">({pct(b.buyers, b.reached)})</span></Td><Td>{money(b.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Social comments → WhatsApp → sales" note="Comment replies that invited people to continue on WhatsApp, and what those chats bought.">
            {!r.social.length ? <Empty>No comment invitations in this period.</Empty> : (
              <Table head={["Channel", "Invited", "Chats started", "Orders", "Revenue"]}>
                {r.social.map(s => <tr key={s.platform}><Td strong>{PLATFORM[s.platform] ?? s.platform}</Td><Td>{s.invites}</Td><Td>{s.chats} <span className="text-ink-400">({pct(s.chats, s.invites)})</span></Td><Td>{s.orders}</Td><Td>{money(s.revenueCents)}</Td></tr>)}
              </Table>
            )}
          </Section>

          <Section title="Was the AI right?" note="Based on the AI's reads of each lead, recorded from now on.">
            {!r.aiReads || !r.aiReads.readyToPay ? <Empty>No leads were read as ready to pay in this period yet.</Empty> : (
              <p className="px-4 py-3 text-sm text-ink-800">
                The AI said <b>{r.aiReads.readyToPay}</b> lead{r.aiReads.readyToPay === 1 ? " was" : "s were"} ready to pay. <b>{r.aiReads.paidWithin14Days}</b> paid within 14 days ({pct(r.aiReads.paidWithin14Days, r.aiReads.readyToPay)}).
                {r.aiReads.notReadyButPaid > 0 && <> {r.aiReads.notReadyButPaid} lead{r.aiReads.notReadyButPaid === 1 ? "" : "s"} it read as cold or lost paid anyway.</>}
              </p>
            )}
          </Section>

          {r.missed.readyNotPaid > 0 && (
            <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <b>{r.missed.readyNotPaid}</b> lead{r.missed.readyNotPaid === 1 ? " was" : "s were"} ready to pay in this period but haven&apos;t paid. They&apos;re in Today until someone follows up.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-card border border-line bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone === "warn" ? "text-amber-700" : "text-ink-900"}`}>{value}</p>
    </div>
  );
}
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-bold text-ink-900">{title}</p>
        {note && <p className="text-[11px] text-ink-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead className="bg-canvas"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-500 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
function Td({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return <td className={`px-4 py-2 ${strong ? "text-left font-semibold text-ink-900" : "text-right text-ink-700"}`}>{children}</td>;
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-3 text-[12px] text-ink-500">{children}</p>;
