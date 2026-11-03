"use client";

// Settings for the AI sales closer (lib/lead-intel.ts, lib/approvals.ts):
//  - lead reads: after new messages the AI judges each lead (Cold/Warm/Hot/
//    Won/OptOut, intent 1–100, ready to pay) and sends changes to the CRM;
//  - approvals: whether the AI may ask the team for a discount (and the most it
//    may ask for) or pass on a refund request. It can never grant either.

import { useCallback, useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { PageInfo } from "@/components/PageInfo";
import { Notice, useNotice } from "@/components/Notice";

interface Settings {
  leadIntel: { enabled: boolean; lsq: { status: string; score: string; reason: string } };
  approvals: { discounts: { enabled: boolean; maxPercent: number }; refunds: { enabled: boolean } };
  lsqConnected?: boolean;
}

const field = "w-full rounded-control border border-line px-3 py-2 text-sm font-mono";

export function SalesCloserCard() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/sales-automation").catch(() => null);
    if (r?.ok) setS(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;

  async function save() {
    if (!s) return;
    setBusy(true); say(null);
    const r = await fetch("/api/admin/sales-automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIntel: s.leadIntel, approvals: s.approvals }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok) { say(j.error || "Couldn't save."); return; }
    setS({ ...s, leadIntel: j.leadIntel, approvals: j.approvals });
    say("Saved.", "ok");
  }

  const li = s.leadIntel, ap = s.approvals;
  const setLsq = (k: "status" | "score" | "reason", v: string) => setS({ ...s, leadIntel: { ...li, lsq: { ...li.lsq, [k]: v } } });
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-4">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-extrabold text-brand-dark flex items-center gap-2"><TrendingUp className="w-4 h-4" /> AI sales closer</h3>
        <PageInfo>After new messages, the AI judges each lead — Cold, Warm, Hot, Won or Opted out, an intent score from 1 to 100, and whether they&apos;re ready to pay — and shows it in Live Chat. Ready-to-pay leads and approval requests ring the alert bell. Changes go to your CRM. It uses your own AI key: about one short AI call per chat with new messages.</PageInfo>
      </div>

      <label className="flex items-start gap-2.5 text-[13px] text-ink-700 cursor-pointer">
        <input type="checkbox" className="mt-0.5 accent-brand-700" checked={li.enabled} onChange={e => setS({ ...s, leadIntel: { ...li, enabled: e.target.checked } })} />
        <span><b>Score every lead</b> — status, intent, ready to pay, and whether a person is needed.</span>
      </label>

      <div className="space-y-2">
        <p className="text-[12px] font-bold text-ink-700">Send to your CRM</p>
        <p className="text-[12px] text-ink-500">HubSpot: its Lead Status is updated (Cold → Open, Warm → In progress, Hot → Open deal, Opted out → Unqualified; Won makes them a Customer). Webhooks, Zapier, Make, Slack, Teams and Google Sheets: subscribe to &ldquo;Lead status or intent changed&rdquo; in Integrations.</p>
        {s.lsqConnected ? (
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-[11px] text-ink-600">LeadSquared field for status<input className={field} placeholder="mx_AI_Lead_Status" value={li.lsq.status} onChange={e => setLsq("status", e.target.value)} /></label>
            <label className="text-[11px] text-ink-600">… for intent score<input className={field} placeholder="mx_AI_Intent_Score" value={li.lsq.score} onChange={e => setLsq("score", e.target.value)} /></label>
            <label className="text-[11px] text-ink-600">… for the reason<input className={field} placeholder="mx_AI_Lead_Reason" value={li.lsq.reason} onChange={e => setLsq("reason", e.target.value)} /></label>
            <p className="sm:col-span-3 text-[11px] text-ink-500">Create these custom fields in LeadSquared first, then paste their schema names. Empty ones aren&apos;t written. Don&apos;t reuse a field your team grades by hand.</p>
          </div>
        ) : <p className="text-[12px] text-ink-500">Connect LeadSquared in Integrations to write these into lead fields too.</p>}
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-[12px] font-bold text-ink-700">What the AI may ask you to approve</p>
        <label className="flex items-start gap-2.5 text-[13px] text-ink-700 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-brand-700" checked={ap.discounts.enabled} onChange={e => setS({ ...s, approvals: { ...ap, discounts: { ...ap.discounts, enabled: e.target.checked } } })} />
          <span><b>Discounts</b> — when a customer negotiates, the AI asks you; it never offers one itself.</span>
        </label>
        {ap.discounts.enabled && (
          <label className="ml-6 flex items-center gap-2 text-[12px] text-ink-600">
            Most it may ask for
            <input type="number" min={1} max={90} className="w-20 rounded-control border border-line px-2 py-1 text-sm" value={ap.discounts.maxPercent} onChange={e => setS({ ...s, approvals: { ...ap, discounts: { ...ap.discounts, maxPercent: Number(e.target.value) } } })} />
            % <span className="text-ink-500">(bigger asks still reach you, marked over the limit; customers never see it)</span>
          </label>
        )}
        <label className="flex items-start gap-2.5 text-[13px] text-ink-700 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-brand-700" checked={ap.refunds.enabled} onChange={e => setS({ ...s, approvals: { ...ap, refunds: { enabled: e.target.checked } } })} />
          <span><b>Refunds</b> — the AI files the request for you to approve or decline; it never promises one.</span>
        </label>
        <p className="text-[11px] text-ink-500">Requests appear on the chat in Live Chat with Approve and Decline. Approving a discount on a cart places the order at the reduced price and sends the payment link. Only admins can decide.</p>
      </div>

      <Notice notice={note} onClose={() => say(null)} />
      <button onClick={save} disabled={busy} className="bg-brand-700 text-white rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
      </button>
    </section>
  );
}
