"use client";

// Emails — every email the platform has sent (owner login codes, invoices,
// dunning notices, weekly recaps, onboarding nudges, affiliate payouts, the
// contact form), what happened to it after Resend accepted it, and a search
// over recipient/subject. Nothing like this existed before: sendEmail() threw
// the Resend result away, so "did that dunning notice even go out" meant
// checking the Resend dashboard by hand, one email at a time.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, MailCheck, MailOpen, MailX, MailWarning, Send, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Panel, Badge, EmptyState, Spinner, MetricTile, ago, type Tone } from "../_ui";

type Row = {
  id: string; tenantId: string | null; company: string | null;
  type: string; to: string; subject: string; status: string; error: string | null;
  sentAt: string; deliveredAt: string | null; openedAt: string | null; clickedAt: string | null; bouncedAt: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  otp: "Login code", invoice: "Invoice / receipt", dunning_failed: "Payment failed",
  dunning_suspended: "Workspace paused", weekly_recap: "Weekly recap", onboarding_nudge: "Onboarding nudge",
  affiliate_commission: "Affiliate payout", contact_form: "Contact form", other: "Other",
};
const TYPES = Object.keys(TYPE_LABEL);

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent", delivered: "Delivered", delayed: "Delayed", opened: "Opened",
  clicked: "Clicked", bounced: "Bounced", complained: "Marked spam", failed: "Failed",
};
const STATUS_TONE: Record<string, Tone> = {
  sent: "info", delivered: "ok", delayed: "warn", opened: "ok",
  clicked: "ok", bounced: "bad", complained: "bad", failed: "bad",
};
const STATUSES = Object.keys(STATUS_LABEL);

const STATUS_ICON: Record<string, typeof Mail> = {
  sent: Send, delivered: MailCheck, delayed: MailWarning, opened: MailOpen,
  clicked: MailOpen, bounced: MailX, complained: MailX, failed: MailX,
};

const sel = "border border-line rounded-control px-2 py-1.5 text-xs bg-white text-ink-900";
const PAGE_SIZE = 50;

type Campaign = {
  id: string; subject: string; status: string; audienceMode: string;
  totalRecipients: number; sentCount: number; failedCount: number; createdAt: string;
};

const CAMPAIGN_TONE: Record<string, Tone> = {
  draft: "muted", sending: "info", sent: "ok", partial: "warn", failed: "bad", cancelled: "muted",
};

export default function EmailsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    if (campaignId) params.set("campaignId", campaignId);
    try {
      const r = await fetch(`/api/owner/emails?${params}`);
      const d = await r.json();
      if (!r.ok || d.error) { setErr(d.error || "Couldn't load the email log."); setRows([]); return; }
      setErr(null); setRows(d.rows ?? []); setTotal(d.total ?? 0);
    } catch { setErr("Couldn't reach the server."); setRows([]); }
  }, [offset, type, status, q, campaignId]);
  useEffect(() => { load(); }, [load]);
  // Any filter change re-starts from the first page — a stale offset past a
  // narrower result set would otherwise render an empty page that looks broken.
  useEffect(() => { setOffset(0); }, [type, status, q, campaignId]);

  // Campaigns refresh alongside the log: a sending one advances every cron tick,
  // so a stale count here would read as a stuck campaign.
  useEffect(() => {
    fetch("/api/owner/broadcast").then(r => r.json())
      .then(d => setCampaigns(d.campaigns ?? [])).catch(() => setCampaigns([]));
  }, [rows]);

  const openCampaign = campaigns?.find(c => c.id === campaignId);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Emails</h1>
          <p className="text-sm text-ink-600">Every email the platform has sent — login codes, invoices, dunning notices, recaps, campaigns — and what happened to it after.</p>
        </div>
        <Link href="/admin/owner/emails/new"
          className="shrink-0 px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New campaign
        </Link>
      </header>

      {err && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{err}</div>}

      {!!campaigns?.length && (
        <Panel title="Campaigns" dense>
          <div className="divide-y divide-line">
            {campaigns.slice(0, 5).map(c => {
              const done = c.sentCount + c.failedCount;
              const pct = c.totalRecipients ? Math.round((done / c.totalRecipients) * 100) : 0;
              return (
                <button key={c.id} onClick={() => setCampaignId(id => (id === c.id ? "" : c.id))}
                  className={`w-full text-left px-4 py-2.5 hover:bg-canvas ${campaignId === c.id ? "bg-canvas" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-ink-900 truncate">{c.subject}</span>
                    <Badge tone={CAMPAIGN_TONE[c.status] ?? "muted"}>{c.status}</Badge>
                    <span className="text-[11px] text-ink-400">{ago(c.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-ink-600 mt-0.5">
                    {c.sentCount} sent{c.failedCount ? ` · ${c.failedCount} failed` : ""} of {c.totalRecipients}
                    {c.status === "sending" && <span className="text-brand-700 font-semibold"> · {pct}% — still sending, continues on each cron tick</span>}
                  </p>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {openCampaign && (
        <div className="flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-card px-4 py-2.5">
          <p className="text-[12px] text-brand-800 flex-1">Showing only <b>{openCampaign.subject}</b> — every recipient of that campaign, with its real delivery outcome.</p>
          <button onClick={() => setCampaignId("")} className="text-brand-700 hover:text-brand-800"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricTile label="This page" value={rows?.length ?? "—"} sub={`of ${total} matching`} />
        <MetricTile label="Delivered" value={rows ? rows.filter(r => ["delivered", "opened", "clicked"].includes(r.status)).length : "—"} tone="ok" />
        <MetricTile label="Opened" value={rows ? rows.filter(r => ["opened", "clicked"].includes(r.status)).length : "—"} />
        <MetricTile label="Bounced / failed" value={rows ? rows.filter(r => ["bounced", "complained", "failed"].includes(r.status)).length : "—"} tone={rows?.some(r => ["bounced", "complained", "failed"].includes(r.status)) ? "bad" : undefined} />
      </div>
      <p className="text-[11px] text-ink-400 -mt-2">Tiles reflect only the rows currently loaded below, not the full {total}-row match.</p>

      <Panel dense>
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search recipient or subject…"
            className="border border-line rounded-control px-2.5 py-1.5 text-xs bg-white text-ink-900 placeholder:text-ink-400 w-56" />
          <select value={type} onChange={e => setType(e.target.value)} className={sel}>
            <option value="">All types</option>
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} className={sel}>
            <option value="">Any status</option>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {(type || status || q || campaignId) && (
            <button onClick={() => { setType(""); setStatus(""); setQ(""); setCampaignId(""); }} className="text-[11px] font-bold text-ink-400 hover:text-ink-700">Reset</button>
          )}
          <span className="ml-auto text-[11px] text-ink-400">{total.toLocaleString()} total</span>
        </div>

        {rows === null && <div className="flex justify-center py-16"><Spinner /></div>}
        {rows !== null && !rows.length && (
          <EmptyState icon={<Mail className="w-5 h-5" />}
            title={type || status || q || campaignId ? "Nothing matches these filters" : "No emails sent yet"}
            body={type || status || q || campaignId ? undefined : "They'll appear here the moment the platform sends its first one — a login code, an invoice, anything."} />
        )}

        <div className="divide-y divide-line">
          {(rows ?? []).map(r => {
            const Icon = STATUS_ICON[r.status] ?? Mail;
            return (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  r.status === "bounced" || r.status === "complained" || r.status === "failed" ? "bg-red-50 text-red-600"
                  : r.status === "opened" || r.status === "clicked" || r.status === "delivered" ? "bg-emerald-50 text-emerald-600"
                  : "bg-canvas text-ink-400"
                }`}><Icon className="w-3.5 h-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold text-ink-900 truncate">{r.subject}</span>
                    <Badge tone="muted">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                    <Badge tone={STATUS_TONE[r.status] ?? "muted"} title={r.error ?? undefined}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                  <p className="text-[11px] text-ink-600 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{r.to}</span>
                    {r.company && <span>· {r.company}</span>}
                    <span className="text-ink-400">· sent {ago(r.sentAt)}</span>
                    {r.openedAt && <span className="text-ink-400">· opened {ago(r.openedAt)}</span>}
                    {r.clickedAt && <span className="text-ink-400">· clicked {ago(r.clickedAt)}</span>}
                  </p>
                  {r.error && <p className="text-[11px] text-red-600 mt-1">{r.error}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-line">
            <span className="text-[11px] text-ink-400">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
            <div className="flex items-center gap-1.5">
              <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                className="p-1.5 rounded-control border border-line text-ink-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-canvas"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}
                className="p-1.5 rounded-control border border-line text-ink-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-canvas"><ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
