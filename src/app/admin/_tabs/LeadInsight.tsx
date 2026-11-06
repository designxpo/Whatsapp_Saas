"use client";

// The AI sales closer in Live Chat:
//  - LeadWord: where the lead stands (lib/lead-intel.ts) — status, intent
//    score, "ready to pay" — as quiet words, with the AI's reason on hover;
//  - LeadReason: that reason as one line under the chat header;
//  - ApprovalCard: a discount or refund the AI asked the team about
//    (lib/approvals.ts). Approve or reject sends the customer the message shown,
//    which can be edited first; cancel closes it without a message.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BadgePercent, CreditCard, Loader2, RotateCcw } from "lucide-react";
import type { LeadSnapshot } from "../_shared";

const ACTION: Record<NonNullable<LeadSnapshot["action"]>, string> = {
  DISCOUNT_REQUEST: "Asked for a discount",
  REFUND_REQUEST: "Wants a refund",
  HUMAN_TAKEOVER: "Needs a person",
};

/**
 * The lead read as plain words for a quiet status line: "Hot 88", with a small
 * "Pay" marker when they are ready to pay. No pill and no colour of its own —
 * in a list row the wait time is the one coloured thing.
 */
export function LeadWord({ lead }: { lead?: LeadSnapshot | null }) {
  if (!lead) return null;
  const title = [lead.reason, lead.action ? ACTION[lead.action] : null].filter(Boolean).join(" · ") || "AI lead read";
  const label = lead.status === "OptOut" ? "Opted out" : lead.status;
  return (
    <span className="whitespace-nowrap" title={title}>
      <span className="sr-only">Lead: </span>{label}{lead.score != null && lead.status !== "OptOut" && <span className="tabular-nums"> {lead.score}</span>}
      {lead.readyToPay && (
        <span className="font-semibold text-emerald-700">
          <span aria-hidden className="px-1 font-normal text-ink-400">·</span><CreditCard className="inline w-3 h-3 mr-0.5 -mt-0.5 align-middle" aria-hidden />Pay<span className="sr-only"> (ready to pay)</span>
        </span>
      )}
    </span>
  );
}

/** The AI's one-line reason, under the chat header: one quiet line, with More when it doesn't fit. */
export function LeadReason({ lead }: { lead?: LeadSnapshot | null }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const reason = lead?.reason ?? "";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reason, open]);
  if (!reason) return null;
  return (
    <div className="flex items-start gap-2 min-w-0 text-[12px] text-ink-500">
      <p ref={ref} className={`min-w-0 flex-1 ${open ? "whitespace-pre-wrap break-words" : "truncate"}`} title={open ? undefined : reason}>
        <span className="font-semibold text-ink-700">AI read:</span> {reason}
      </p>
      {(overflows || open) && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="shrink-0 -my-1 min-h-8 md:min-h-6 px-1 rounded text-[12px] font-medium text-brand-700 hover:underline">
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
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

  if (!req) return note ? <p className={`mx-3 md:mx-5 mt-2 text-[12px] font-semibold ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p> : null;

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
    <div className="mx-3 md:mx-5 mt-2 rounded-[10px] border border-amber-200 bg-amber-50/70 px-3 py-2.5 space-y-2" role="region" aria-label="Approval needed">
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
          <textarea id={`approval-msg-${req.id}`} rows={3} value={text} onChange={e => setText(e.target.value)} className="w-full rounded-[8px] border border-line bg-white px-3 py-2 text-base md:text-[13px]" />
          {mode === "approve" && req.kind === "discount" && <p className="text-[11px] text-ink-500">If they have items in their cart, the order is placed at the reduced price and its payment link is added to this message.</p>}
          <div className="flex items-center gap-2">
            <button onClick={() => decide(mode)} disabled={busy || !text.trim()} className={`h-11 md:h-8 px-3 rounded-[8px] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 ${mode === "approve" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}>
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {mode === "approve" ? "Approve & send" : "Decline & send"}
            </button>
            <button onClick={() => setMode(null)} disabled={busy} className="h-11 md:h-8 px-3 rounded-[8px] border border-line bg-white text-[13px] font-medium text-ink-700">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setMode("approve"); setText(req.approveMessage); }} className="h-11 md:h-8 px-3 rounded-[8px] bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-semibold">Approve…</button>
          <button onClick={() => { setMode("reject"); setText(req.rejectMessage); }} className="h-11 md:h-8 px-3 rounded-[8px] border border-red-200 bg-white text-red-700 text-[13px] font-semibold hover:bg-red-50">Decline…</button>
          <button onClick={() => decide("cancel")} disabled={busy} title="Close without messaging the customer" className="h-11 md:h-8 px-3 rounded-[8px] text-[13px] font-medium text-ink-600 hover:bg-white">Close without a message</button>
        </div>
      )}
      {note && <p className={`text-[12px] font-semibold ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p>}
    </div>
  );
}
