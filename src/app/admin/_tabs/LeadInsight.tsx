"use client";

// The AI sales closer in Live Chat:
//  - LeadPill: where the lead stands (lib/lead-intel.ts) — status, intent
//    score, "ready to pay" — with the AI's one-line reason on hover;
//  - ApprovalCard: a discount or refund the AI asked the team about
//    (lib/approvals.ts). Approve or reject sends the customer the message shown,
//    which can be edited first; cancel closes it without a message.

import { useCallback, useEffect, useState } from "react";
import { BadgePercent, CreditCard, Loader2, RotateCcw, UserRound } from "lucide-react";
import type { LeadSnapshot } from "../_shared";

const TONE: Record<LeadSnapshot["status"], string> = {
  Hot: "bg-red-50 text-red-700 border-red-200",
  Warm: "bg-amber-50 text-amber-800 border-amber-200",
  Cold: "bg-canvas text-ink-600 border-line",
  Won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OptOut: "bg-canvas text-ink-500 border-line",
};
const ACTION: Record<NonNullable<LeadSnapshot["action"]>, string> = {
  DISCOUNT_REQUEST: "Asked for a discount",
  REFUND_REQUEST: "Wants a refund",
  HUMAN_TAKEOVER: "Needs a person",
};

/** Status and intent, plus "ready to pay". `compact` for list rows. */
export function LeadPill({ lead, compact = false }: { lead?: LeadSnapshot | null; compact?: boolean }) {
  if (!lead) return null;
  const title = [lead.reason, lead.action ? ACTION[lead.action] : null].filter(Boolean).join(" · ") || "AI lead read";
  const label = lead.status === "OptOut" ? "Opted out" : lead.status;
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className={`inline-flex items-center gap-1 rounded-full border font-bold ${compact ? "text-[9px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"} ${TONE[lead.status]}`}>
        {compact ? label.toUpperCase() : label}
        {lead.score != null && lead.status !== "OptOut" && <span className="tabular-nums opacity-80">{lead.score}</span>}
      </span>
      {lead.readyToPay && (
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-700 text-white font-bold ${compact ? "text-[9px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"}`}>
          <CreditCard className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} aria-hidden /> {compact ? "PAY" : "Ready to pay"}
        </span>
      )}
      {!compact && lead.action === "HUMAN_TAKEOVER" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold px-2 py-0.5"><UserRound className="w-3 h-3" aria-hidden /> Needs a person</span>
      )}
    </span>
  );
}

/** The AI's one-line reason, under the chat header. */
export function LeadReason({ lead }: { lead?: LeadSnapshot | null }) {
  if (!lead?.reason) return null;
  return <p className="text-[12px] text-ink-600 truncate" title={lead.reason}><span className="font-semibold text-ink-900">AI read:</span> {lead.reason}</p>;
}

interface Request {
  id: string; kind: "discount" | "refund"; percent: number | null; overLimit: boolean; reason: string | null;
  createdAt: string; approveMessage: string; rejectMessage: string;
}

export function ApprovalCard({ conversationId, onDecided }: { conversationId: string; onDecided: () => void }) {
  const [req, setReq] = useState<Request | null>(null);
  const [maxPercent, setMaxPercent] = useState<number | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/approvals?conversationId=${encodeURIComponent(conversationId)}&status=pending`).catch(() => null);
    if (!r?.ok) { setReq(null); return; }
    const j = await r.json();
    setReq((j.requests ?? [])[0] ?? null);
    setMaxPercent(j.maxPercent ?? null);
  }, [conversationId]);
  useEffect(() => { setMode(null); setNote(null); load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);

  if (!req) return note ? <p className={`mx-5 mt-2 text-[12px] font-semibold ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p> : null;

  async function decide(decision: "approve" | "reject" | "cancel") {
    if (!req) return;
    setBusy(true); setNote(null);
    const r = await fetch("/api/admin/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: req.id, decision, message: decision === "cancel" ? undefined : text }) }).catch(() => null);
    const j = await r?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!r?.ok) { setNote({ ok: false, text: j.error || "That didn't work." }); return; }
    setNote({ ok: !j.warning, text: j.warning || (decision === "approve" ? "Approved — the customer has been told." : decision === "reject" ? "Declined — the customer has been told." : "Request closed.") });
    setMode(null);
    await load();
    onDecided();
  }

  const Icon = req.kind === "discount" ? BadgePercent : RotateCcw;
  return (
    <div className="mx-5 mt-3 rounded-card border border-amber-200 bg-amber-50/70 p-3 space-y-2" role="region" aria-label="Approval needed">
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 text-amber-800 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink-900">
            {req.kind === "discount" ? `AI asked to offer ${req.percent}% off` : "AI passed on a refund request"}
            {req.overLimit && maxPercent != null && <span className="ml-2 text-[11px] font-bold text-red-700">over your {maxPercent}% limit</span>}
          </p>
          {req.reason && <p className="text-[12px] text-ink-700">{req.reason}</p>}
          <p className="text-[11px] text-ink-500">The customer was told the team will confirm. Nothing has been promised.</p>
        </div>
      </div>
      {mode ? (
        <div className="space-y-2">
          <label className="block text-[11px] font-bold text-ink-600" htmlFor={`approval-msg-${req.id}`}>Message to the customer</label>
          <textarea id={`approval-msg-${req.id}`} rows={3} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-control border border-line bg-white px-3 py-2 text-[13px]" />
          {mode === "approve" && req.kind === "discount" && <p className="text-[11px] text-ink-500">If they have items in their cart, the order is placed at the reduced price and its payment link is added to this message.</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => decide(mode)} disabled={busy || !text.trim()} className={`px-3 py-1.5 rounded-control text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60 ${mode === "approve" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {mode === "approve" ? "Approve & send" : "Decline & send"}
            </button>
            <button onClick={() => setMode(null)} disabled={busy} className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-700">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setMode("approve"); setText(req.approveMessage); }} className="px-3 py-1.5 rounded-control bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold">Approve…</button>
          <button onClick={() => { setMode("reject"); setText(req.rejectMessage); }} className="px-3 py-1.5 rounded-control border border-red-200 bg-white text-red-700 text-xs font-bold hover:bg-red-50">Decline…</button>
          <button onClick={() => decide("cancel")} disabled={busy} title="Close without messaging the customer" className="px-3 py-1.5 rounded-control text-xs font-bold text-ink-600 hover:bg-white">Close without a message</button>
        </div>
      )}
      {note && <p className={`text-[12px] font-semibold ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p>}
    </div>
  );
}
