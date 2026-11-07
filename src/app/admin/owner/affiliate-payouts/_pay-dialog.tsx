"use client";

// "Pay now" for a payout approved in manual mode. Opening it POSTs
// manual-instructions (the one owner-only, audited place the destination is
// decrypted), shows what to pay and where, then takes the UTR / UPI reference.
//
// The decrypted details live ONLY in this component's state. The page mounts it
// while open and unmounts it on close (no exit animation on purpose: the shared
// Modal holds its last content in a ref while it animates out), so nothing
// survives the dialog. They are never logged, never put in a page URL, and the
// QR is rendered as inline SVG rather than a data: URL.

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, Smartphone, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/overlay";
import { postAction, rupees, type ManualInstructions, type PayoutRow } from "./_api";

const CANCEL_PHRASE = "NOT PAID";   // MANUAL_CANCEL_CONFIRMATION in the library

export function PayDialog({ payout, onClose, onDone }: {
  payout: PayoutRow;
  onClose: () => void;
  /** Called after a successful record or cancel, with a line to show on the row. */
  onDone: (message: string) => void;
}) {
  const [instr, setInstr] = useState<ManualInstructions | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState<"record" | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let live = true;
    postAction<{ instructions: ManualInstructions }>("manual-instructions", { payoutId: payout.id })
      .then(j => { if (live) setInstr(j.instructions); })
      .catch((e: unknown) => { if (live) setLoadErr(e instanceof Error ? e.message : "Couldn't open the payment details."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [payout.id]);

  const upiLink = instr?.upiLink ?? null;
  useEffect(() => {
    if (!upiLink) return;
    let live = true;
    QRCode.toString(upiLink, { type: "svg", margin: 1, width: 184, errorCorrectionLevel: "M" })
      .then(svg => { if (live) setQrSvg(svg); })
      .catch(() => { /* the QR is a convenience; the details above are enough */ });
    return () => { live = false; };
  }, [upiLink]);

  const close = () => { if (!busy) onClose(); };

  async function record() {
    setBusy("record"); setErr(null);
    try {
      await postAction("record-payment", { payoutId: payout.id, utr: utr.trim() });
      onDone(`Recorded as paid (reference ${utr.trim().toUpperCase().replace(/\s+/g, "")}). The affiliate has been emailed.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record the payment.");
      setBusy(null);
    }
  }

  async function cancelPayout() {
    setBusy("cancel"); setErr(null);
    try {
      await postAction("cancel-manual", { payoutId: payout.id, reason: reason.trim(), confirmation: typed.trim() });
      onDone("Payout cancelled. Its commissions are back in the queue and can be paid later.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't cancel the payout.");
      setBusy(null);
    }
  }

  const amount = instr?.amountCents ?? payout.amountCents;
  const canCancel = typed.trim() === CANCEL_PHRASE && !!reason.trim() && !busy;

  return (
    <Modal open onClose={close} size="sm" title={`Pay ${rupees(amount)}`}
      subtitle={payout.affiliateName ?? payout.affiliateEmail ?? undefined}
      footer={
        <div className="flex justify-end w-full">
          <button type="button" onClick={close} disabled={!!busy}
            className="min-h-10 px-4 rounded-control border border-line text-sm font-semibold text-ink-600 hover:bg-canvas disabled:opacity-60">Close</button>
        </div>
      }>
      <div className="space-y-4">
        {loading && (
          <p className="flex items-center gap-2 text-[13px] text-ink-600"><Loader2 className="w-4 h-4 animate-spin" /> Opening the payment details…</p>
        )}
        {loadErr && (
          <div role="alert" className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{loadErr}</span>
          </div>
        )}

        {instr && (
          <section aria-label="Payment details" className="rounded-card border border-line divide-y divide-line">
            <CopyField label="Amount" value={rupees(instr.amountCents)} copyValue={(instr.amountCents / 100).toFixed(2)} />
            <CopyField label="Name" value={instr.name} />
            {instr.kind === "upi" && instr.vpa && <CopyField label="UPI ID" value={instr.vpa} mono />}
            {instr.kind === "bank" && instr.accountNumber && <CopyField label="Account number" value={instr.accountNumber} mono />}
            {instr.kind === "bank" && instr.ifsc && <CopyField label="IFSC" value={instr.ifsc} mono />}
          </section>
        )}

        {instr?.upiLink && (
          <>
            {/* On a phone the owner pays from this device: hand off to the UPI app. */}
            <a href={instr.upiLink}
              className="md:hidden flex items-center justify-center gap-2 min-h-11 w-full rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold">
              <Smartphone className="w-4 h-4" /> Open in UPI app
            </a>
            {/* On a computer: scan with the phone that has the UPI app. */}
            {qrSvg && (
              <div className="hidden md:flex flex-col items-center gap-1.5">
                <div aria-label="UPI payment QR code" role="img" className="bg-white p-1 rounded-control border border-line [&>svg]:block [&>svg]:w-[184px] [&>svg]:h-[184px]"
                  dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <p className="text-[11px] text-ink-600">Scan with your phone&apos;s UPI app</p>
              </div>
            )}
          </>
        )}

        {instr && (
          <p className="text-[12px] text-ink-600 leading-relaxed">
            Before you send, check that your app shows the name <b className="text-ink-900">{instr.name}</b>. If it shows someone else, stop and use &ldquo;I did not pay this&rdquo; below.
          </p>
        )}

        {!loading && (
          <form onSubmit={e => { e.preventDefault(); if (utr.trim() && !busy) record(); }} className="space-y-2 border-t border-line pt-4">
            <label htmlFor="pay-utr" className="block text-[13px] font-bold text-ink-900">After you pay: the UTR / UPI reference number</label>
            <p className="text-[12px] text-ink-600">Your bank or UPI app shows it on the payment receipt (10 to 22 letters or digits).</p>
            <input id="pay-utr" value={utr} onChange={e => setUtr(e.target.value)} placeholder="e.g. 412345678901"
              autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
              className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-ink-900 font-mono bg-white focus:border-brand-500" />
            <button type="submit" disabled={!utr.trim() || !!busy}
              className="w-full sm:w-auto min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
              {busy === "record" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mark as paid
            </button>
          </form>
        )}

        {err && <p role="alert" className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2">{err}</p>}

        {!loading && (
          <div className="border-t border-line pt-3">
            {!showCancel ? (
              <button type="button" onClick={() => setShowCancel(true)} disabled={!!busy}
                className="text-[12px] font-bold text-ink-600 hover:text-red-700 underline underline-offset-2 disabled:opacity-60">
                I did not pay this
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-[12px] text-ink-600 leading-relaxed">
                  Use this only if <b className="text-ink-900">no money was sent</b>. The commissions go back to the queue and can be paid later.
                  If you did pay, record the reference above instead, or the affiliate could be paid twice.
                </p>
                <label htmlFor="pay-cancel-typed" className="block text-[12px] font-bold text-ink-900">Type {CANCEL_PHRASE} to confirm</label>
                <input id="pay-cancel-typed" value={typed} onChange={e => setTyped(e.target.value)} placeholder={CANCEL_PHRASE}
                  autoComplete="off" spellCheck={false}
                  className="w-full rounded-control border border-line px-3 py-2 text-sm text-ink-900 bg-white focus:border-brand-500" />
                <label htmlFor="pay-cancel-reason" className="block text-[12px] font-bold text-ink-900">Reason</label>
                <textarea id="pay-cancel-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
                  placeholder="e.g. The name in my UPI app did not match"
                  className="w-full rounded-control border border-line px-3 py-2 text-sm text-ink-900 bg-white focus:border-brand-500" />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={cancelPayout} disabled={!canCancel}
                    className="min-h-10 px-4 rounded-control bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1.5">
                    {busy === "cancel" && <Loader2 className="w-4 h-4 animate-spin" />} Cancel this payout
                  </button>
                  <button type="button" onClick={() => { setShowCancel(false); setTyped(""); setReason(""); }} disabled={!!busy}
                    className="min-h-10 px-4 rounded-control border border-line text-sm font-semibold text-ink-600 hover:bg-canvas disabled:opacity-60">
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function CopyField({ label, value, copyValue, mono }: { label: string; value: string; copyValue?: string; mono?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    const done = (s: "copied" | "failed") => { setState(s); clearTimeout(timer.current); timer.current = setTimeout(() => setState("idle"), 2000); };
    if (!navigator.clipboard) { done("failed"); return; }
    navigator.clipboard.writeText(copyValue ?? value).then(() => done("copied"), () => done("failed"));
  };
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em]">{label}</p>
        <p className={`text-sm font-bold text-ink-900 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}
        className="shrink-0 min-h-9 flex items-center gap-1 px-2.5 rounded-control border border-line bg-white text-[12px] font-bold text-ink-600 hover:bg-canvas">
        {state === "copied" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
    </div>
  );
}

