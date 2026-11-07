"use client";

// Affiliate payouts: who can be paid, what is waiting for approval, and what
// needs paying by hand. Every rule lives in src/lib/affiliate-payouts.ts; this
// page only asks for actions and shows the server's answer word for word.
//
// Manual mode (no RazorpayX): approve -> "Pay now" opens the payment details ->
// pay from your own bank/UPI app -> record the UTR / UPI reference. Nothing here
// shows more of a payout destination than its kind and last 4 digits, except the
// pay dialog, which holds the full details only while it is open.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, AlertTriangle, Loader2, Wallet, Flag, Info } from "lucide-react";
import { Panel, Badge, EmptyState, Placeholder, ago, type Tone } from "../_ui";
import { HeaderRow, ActionRow } from "@/components/header-row";
import { usePromptDialog } from "@/components/prompt-dialog";
import { ConfirmProvider, useConfirm } from "@/components/confirm-dialog";
import { PayDialog, CopyField } from "./_pay-dialog";
import {
  postAction, rupees, shortDate, destinationText, flagWords, BLOCKER_TEXT, PAYOUT_ACCOUNT_COOLDOWN_DAYS,
  type PayoutData, type Payable, type PayoutRow, type FlaggedCommission, type VerificationDetails,
} from "./_api";

type RowMsg = { tone: "error" | "info"; text: string };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_approval: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved, not sent", tone: "warn" },
  processing: { label: "Sending", tone: "info" },
  paid: { label: "Paid", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  reversed: { label: "Reversed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
};
function statusOf(p: PayoutRow): { label: string; tone: Tone } {
  if (p.status === "processing" && p.manual) return { label: "Approved, pay now", tone: "warn" };
  return STATUS[p.status] ?? { label: p.status.replace(/_/g, " "), tone: "muted" };
}
/** Rows that need the owner first; then newest first (the API already sorts by date). */
function needsAction(p: PayoutRow): number {
  if (p.status === "awaiting_approval") return 0;
  if (p.status === "processing" && p.manual) return 0;
  if (p.status === "approved") return 0;
  return 1;
}

export default function AffiliatePayoutsPage() {
  return <ConfirmProvider><PayoutsConsole /></ConfirmProvider>;
}

function PayoutsConsole() {
  const [data, setData] = useState<PayoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, RowMsg>>({});
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const [ask, promptDialog] = usePromptDialog();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/affiliate-payouts", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Partial<PayoutData> & { error?: string };
      if (!r.ok || j.error) { setLoadErr(j.error || `Couldn't load (HTTP ${r.status})`); }
      else { setLoadErr(null); setData(j as PayoutData); }
    } catch { setLoadErr("Couldn't reach the server."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setMsg = (id: string, m: RowMsg | null) => setMsgs(prev => {
    const next = { ...prev };
    if (m) next[id] = m; else delete next[id];
    return next;
  });

  /** Run one action: busy state on its button, the API's answer on its row, then reload. */
  async function act(rowId: string, key: string, fn: () => Promise<string | void>) {
    setBusy(key); setMsg(rowId, null);
    try {
      const info = await fn();
      if (info) setMsg(rowId, { tone: "info", text: info });
    } catch (e) {
      setMsg(rowId, { tone: "error", text: e instanceof Error ? e.message : "That didn't work." });
    } finally {
      setBusy(null);
      await load();
    }
  }

  // ── affiliate actions ──
  const createPayout = (a: Payable) => act(a.affiliateId, `create:${a.affiliateId}`, async () => {
    const j = await postAction<{ success?: boolean; payoutId?: string | null; message?: string }>("create-request", { affiliateId: a.affiliateId });
    if (!j.success) return j.message ?? "Nothing payable right now.";
    return "Payout created. Approve it under Payouts below.";
  });

  async function verifyAccount(a: Payable) {
    // Load the full destination for the Rs 1 check (owner-only, audited, refused once verified).
    let details: VerificationDetails | null = null, detailsError: string | null = null;
    try { details = (await postAction<{ details: VerificationDetails }>("verification-details", { affiliateId: a.affiliateId })).details; }
    catch (err) { detailsError = err instanceof Error ? err.message : "Could not load the account details."; }
    const note = await ask({
      title: `Verify ${a.name}'s payout account?`,
      message: (
        <div className="space-y-2">
          <p>Send Rs 1 to this account first and check the name your app shows.</p>
          <p>Verify only if it matches <b className="text-ink-900">{a.payoutName || a.name}</b>. Payouts still wait {PAYOUT_ACCOUNT_COOLDOWN_DAYS} days after the account was last changed.</p>
          {details ? (
            <div className="rounded-control border border-line divide-y divide-line">
              {details.kind === "upi" && details.vpa && <CopyField label="UPI ID" value={details.vpa} mono />}
              {details.kind === "bank" && details.accountNumber && <CopyField label="Account number" value={details.accountNumber} mono />}
              {details.kind === "bank" && details.ifsc && <CopyField label="IFSC" value={details.ifsc} mono />}
              {details.upiLink && (
                <div className="px-3 py-2.5">
                  <a href={details.upiLink} className="text-[13px] font-bold text-brand-700 underline">Send {rupees(details.amountCents)} in your UPI app</a>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-[12px]">{destinationText(a.payoutKind, a.payoutLast4, a.payoutName)}</p>
              {detailsError && <p className="text-[12px] text-red-700">{detailsError}</p>}
            </>
          )}
        </div>
      ),
      label: "Note: what you checked",
      placeholder: "e.g. Sent Rs 1, UPI app showed RAHUL SHARMA",
      confirmLabel: "Verify account", required: true, multiline: true,
    });
    if (note === null) return;
    await act(a.affiliateId, `verify:${a.affiliateId}`, async () => {
      await postAction("verify-account", { affiliateId: a.affiliateId, note });
      return "Payout account verified.";
    });
  }

  async function setHold(a: Payable, hold: boolean) {
    const note = await ask(hold ? {
      title: `Put ${a.name} on hold?`,
      message: "No payout can be created or approved for this affiliate until you remove the hold.",
      label: "Reason", placeholder: "e.g. Checking a refund on a referred account",
      confirmLabel: "Put on hold", required: true, multiline: true, tone: "danger",
    } : {
      title: `Remove the hold on ${a.name}?`,
      message: "Payouts for this affiliate can be created and approved again.",
      label: "Note", placeholder: "e.g. Refund check done, all fine",
      confirmLabel: "Remove hold", required: true, multiline: true,
    });
    if (note === null) return;
    await act(a.affiliateId, `hold:${a.affiliateId}`, async () => {
      await postAction("risk-hold", { affiliateId: a.affiliateId, hold, note });
      return hold ? "On hold." : "Hold removed.";
    });
  }

  // ── payout actions ──
  async function approve(p: PayoutRow, retry = false) {
    const manual = p.payByHand || p.manual;
    const ok = await confirm({
      title: retry ? "Retry sending this payout?" : `Approve ${rupees(p.amountCents)}?`,
      message: manual
        ? "Approving does not send any money. Next, use Pay now to see the payment details, pay from your bank or UPI app, then record the reference number."
        : retry
          ? "An earlier send had an unknown outcome. Sending again is safe: RazorpayX will not pay the same payout twice."
          : "RazorpayX sends this money as soon as you approve. It cannot be undone.",
      facts: [
        { label: "Amount", value: rupees(p.amountCents) },
        { label: "Affiliate", value: p.affiliateName ?? p.affiliateEmail ?? p.affiliateId },
        { label: "Pays to", value: destinationText(p.destination.kind, p.destination.last4, p.destination.name) },
      ],
      confirmLabel: retry ? "Retry send" : "Approve",
      tone: manual ? "neutral" : "caution",
    });
    if (!ok) return;
    await act(p.id, `approve:${p.id}`, async () => {
      await postAction("approve", { payoutId: p.id });
      return manual ? "Approved. Use Pay now to pay it." : "Approved and sent to RazorpayX.";
    });
  }

  async function reject(p: PayoutRow) {
    const reason = await ask({
      title: `Reject ${rupees(p.amountCents)}?`,
      message: "The commissions in this payout go back to the queue and can be paid later.",
      label: "Reason", placeholder: "e.g. Waiting for the customer's refund window",
      confirmLabel: "Reject payout", required: true, multiline: true, tone: "danger",
    });
    if (reason === null) return;
    await act(p.id, `reject:${p.id}`, async () => {
      await postAction("reject", { payoutId: p.id, reason });
      return "Rejected.";
    });
  }

  // ── flagged commissions ──
  async function clearFlag(c: FlaggedCommission, who: string) {
    const note = await ask({
      title: `Clear the flag on ${rupees(c.commissionCents)}?`,
      message: (
        <div className="space-y-2">
          <p>{who}: {flagWords(c.flagReason).join("; ")}.</p>
          <p>Clear it only if you have checked the referral is genuine. The commission then becomes payable once its hold ends.</p>
        </div>
      ),
      label: "Note: what you checked", placeholder: "e.g. Different people, confirmed by phone",
      confirmLabel: "Clear flag", required: true, multiline: true,
    });
    if (note === null) return;
    await act(c.id, `clear:${c.id}`, async () => {
      await postAction("clear-flag", { commissionId: c.id, note });
      return "Flag cleared.";
    });
  }

  const nameOf = (affiliateId: string) => {
    const a = data?.affiliates.find(x => x.affiliateId === affiliateId);
    return a ? a.name : `Affiliate ${affiliateId.slice(0, 8)}`;
  };
  const anyBusy = busy !== null;
  const affiliates = [...(data?.affiliates ?? [])].sort((x, y) => y.payableCents - x.payableCents || x.name.localeCompare(y.name));
  const payouts = [...(data?.payouts ?? [])].sort((x, y) => needsAction(x) - needsAction(y));
  const waiting = payouts.filter(p => needsAction(p) === 0).length;

  return (
    <div className="space-y-5">
      <HeaderRow align="start" actions={
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      }>
        <h1 className="text-xl font-extrabold text-brand-dark">Affiliate payouts</h1>
        <p className="text-sm text-ink-600">Approve, pay and record affiliate commission payouts.</p>
      </HeaderRow>

      {loadErr && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{loadErr}</span>
        </div>
      )}
      {loading && !data && <Placeholder />}

      {data && (
        <>
          <ModeBanner data={data} />

          <Panel title={`Ready to pay (${affiliates.length})`} dense>
            {!affiliates.length ? (
              <EmptyState icon={<Wallet className="w-5 h-5" />} title="Nothing owed yet"
                body="Affiliates appear here once they earn commission or add a payout account." />
            ) : (
              <ul className="divide-y divide-line">
                {affiliates.map(a => (
                  <li key={a.affiliateId} className="px-4 py-3">
                    <AffiliateRow a={a} busy={busy} anyBusy={anyBusy}
                      onCreate={() => createPayout(a)} onVerify={() => verifyAccount(a)} onHold={() => setHold(a, !a.riskHold)} />
                    <RowMessage m={msgs[a.affiliateId]} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Payouts${waiting ? ` (${waiting} need you)` : ""}`} dense>
            {!payouts.length ? (
              <EmptyState icon={<Wallet className="w-5 h-5" />} title="No payouts yet"
                body="Use Create payout above to bundle an affiliate's payable commission into a payout for approval." />
            ) : (
              <ul className="divide-y divide-line">
                {payouts.map(p => (
                  <li key={p.id} className="px-4 py-3">
                    <PayoutItem p={p} busy={busy} anyBusy={anyBusy}
                      onApprove={() => approve(p)} onRetry={() => approve(p, true)} onReject={() => reject(p)}
                      onPay={() => { setMsg(p.id, null); setPaying(p); }} />
                    <RowMessage m={msgs[p.id]} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Flagged commissions (${data.flagged.length})`} dense>
            {!data.flagged.length ? (
              <EmptyState icon={<Flag className="w-5 h-5" />} title="Nothing flagged"
                body="Commissions that look like self-referrals, bursts of sign-ups, disputes or refunds are held here for review." />
            ) : (
              <ul className="divide-y divide-line">
                {data.flagged.map(c => {
                  const who = nameOf(c.affiliateId);
                  return (
                    <li key={c.id} className="px-4 py-3">
                      <HeaderRow align="start" actions={
                        <Btn onClick={() => clearFlag(c, who)} busy={busy === `clear:${c.id}`} disabled={anyBusy}>Clear flag</Btn>
                      }>
                        <p className="text-sm text-ink-900"><b className="tabular-nums">{rupees(c.commissionCents)}</b> · {who}</p>
                        <ul className="mt-1 space-y-0.5">
                          {flagWords(c.flagReason).map(w => (
                            <li key={w} className="text-[12px] text-amber-700 flex items-start gap-1.5"><Flag className="w-3 h-3 shrink-0 mt-0.5" />{w}</li>
                          ))}
                        </ul>
                        <p className="text-[11px] text-ink-400 mt-1">Customer {c.tenantId.slice(0, 8)} · recorded {ago(c.createdAt)}</p>
                      </HeaderRow>
                      <RowMessage m={msgs[c.id]} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      )}

      {paying && (
        <PayDialog payout={paying} onClose={() => setPaying(null)}
          onDone={message => { const id = paying.id; setPaying(null); setMsg(id, { tone: "info", text: message }); load(); }} />
      )}
      {promptDialog}
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────────

function ModeBanner({ data }: { data: PayoutData }) {
  const L = data.limits;
  const manual = data.mode === "manual";
  const limits: [string, string][] = [
    ["Minimum payout", rupees(L.minCents)],
    ["Per payout", `up to ${rupees(L.maxCents)}`],
    ["Per affiliate, 30 days", `up to ${rupees(L.affiliate30dCents)}`],
    ["All affiliates, per day", `up to ${rupees(L.globalDailyCents)}`],
    ["Hold after the customer pays", `${L.holdDays} day${L.holdDays === 1 ? "" : "s"}`],
  ];
  return (
    <section className={`rounded-card border px-4 py-3 ${manual ? "bg-amber-50 border-amber-200" : "bg-brand-50 border-brand-100"}`}>
      <p className={`text-[13px] font-bold flex items-start gap-2 ${manual ? "text-amber-800" : "text-brand-700"}`}>
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{manual
          ? "Manual payouts: approve, pay from your bank or UPI app, then record the reference number."
          : "Payouts are sent automatically by RazorpayX after you approve."}</span>
      </p>
      {!manual && !data.configured && (
        <p className="text-[12px] text-red-700 mt-1">RazorpayX is not configured, so approvals will fail until it is.</p>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2 mt-3">
        {limits.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em]">{k}</dt>
            <dd className="text-[13px] font-bold text-ink-900 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {L.autoApproveMaxCents > 0 && (
        <p className="text-[11px] text-ink-600 mt-2">Payouts up to {rupees(L.autoApproveMaxCents)} are approved automatically for affiliates who have been paid before.</p>
      )}
    </section>
  );
}

function AffiliateRow({ a, busy, anyBusy, onCreate, onVerify, onHold }: {
  a: Payable; busy: string | null; anyBusy: boolean; onCreate: () => void; onVerify: () => void; onHold: () => void;
}) {
  const cooldownEnd = a.changedAt ? new Date(Date.parse(a.changedAt) + PAYOUT_ACCOUNT_COOLDOWN_DAYS * 86_400_000).toISOString() : null;
  const blocked = a.blockers.length > 0;
  return (
    <HeaderRow align="start" actions={
      <>
        <Btn primary onClick={onCreate} busy={busy === `create:${a.affiliateId}`} disabled={anyBusy || blocked}
          title={blocked ? "Fix the items listed first" : undefined}>Create payout</Btn>
        {a.payoutKind && !a.verified && (
          <Btn onClick={onVerify} busy={busy === `verify:${a.affiliateId}`} disabled={anyBusy}>Verify account</Btn>
        )}
        <Btn danger={!a.riskHold} onClick={onHold} busy={busy === `hold:${a.affiliateId}`} disabled={anyBusy}>
          {a.riskHold ? "Remove hold" : "Put on hold"}
        </Btn>
      </>
    }>
      <p className="text-sm font-bold text-ink-900 break-words">{a.name}</p>
      <p className="text-[11px] text-ink-400 break-all">{a.email}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[12px] text-ink-600 tabular-nums">
        <span>Payable <b className={a.payableCents > 0 ? "text-ink-900" : ""}>{rupees(a.payableCents)}</b></span>
        {a.holdingCents > 0 && <span>Holding {rupees(a.holdingCents)}</span>}
        {a.flaggedCents > 0 && <span className="text-amber-700">Flagged {rupees(a.flaggedCents)}</span>}
        {a.clawbackCents !== 0 && <span className="text-red-700">Clawbacks {rupees(-Math.abs(a.clawbackCents))}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
        <span className="text-[12px] text-ink-900 break-words">{destinationText(a.payoutKind, a.payoutLast4, a.payoutName)}</span>
        {a.payoutKind && (a.verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Not verified</Badge>)}
      </div>

      {blocked ? (
        <ul className="mt-1.5 space-y-0.5">
          {a.blockers.map(b => (
            <li key={b} className="text-[12px] text-amber-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{BLOCKER_TEXT[b] ?? b.replace(/_/g, " ")}{b === "payout_account_changed_recently" && cooldownEnd ? ` (payable from ${shortDate(cooldownEnd)})` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5"><Badge tone="ok">Can be paid</Badge></p>
      )}
      {a.riskNote && <p className="text-[12px] text-ink-600 mt-1 break-words">Note: {a.riskNote}</p>}
    </HeaderRow>
  );
}

function PayoutItem({ p, busy, anyBusy, onApprove, onRetry, onReject, onPay }: {
  p: PayoutRow; busy: string | null; anyBusy: boolean;
  onApprove: () => void; onRetry: () => void; onReject: () => void; onPay: () => void;
}) {
  const st = statusOf(p);
  let actions: ReactNode = null;
  if (p.status === "awaiting_approval") actions = (
    <>
      <Btn primary onClick={onApprove} busy={busy === `approve:${p.id}`} disabled={anyBusy}>Approve</Btn>
      <Btn danger onClick={onReject} busy={busy === `reject:${p.id}`} disabled={anyBusy}>Reject</Btn>
    </>
  );
  else if (p.status === "approved") actions = <Btn primary onClick={onRetry} busy={busy === `approve:${p.id}`} disabled={anyBusy}>Retry send</Btn>;
  else if (p.status === "processing" && p.manual) actions = <Btn primary onClick={onPay} disabled={anyBusy}>Pay now</Btn>;

  return (
    <HeaderRow align="start" actions={actions}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-extrabold text-ink-900 tabular-nums">{rupees(p.amountCents)}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        {p.manual && p.status !== "awaiting_approval" && <Badge tone="muted">Paid by hand</Badge>}
      </div>
      <p className="text-[13px] text-ink-900 mt-1 break-words">{p.affiliateName ?? p.affiliateEmail ?? `Affiliate ${p.affiliateId.slice(0, 8)}`}</p>
      <p className="text-[12px] text-ink-600 break-words">{destinationText(p.destination.kind, p.destination.last4, p.destination.name)}</p>
      <p className="text-[11px] text-ink-400 mt-0.5 break-words">
        Created {ago(p.createdAt)}
        {p.approvedAt && ` · approved ${ago(p.approvedAt)}${p.approvedBy ? ` by ${p.approvedBy}` : ""}`}
        {p.utr && ` · reference ${p.utr}`}
      </p>
      {p.failureReason && <p className="text-[12px] text-red-700 mt-0.5 break-words">{p.failureReason}</p>}
    </HeaderRow>
  );
}

function Btn({ children, onClick, busy, disabled, primary, danger, title }: {
  children: ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string;
}) {
  const look = primary
    ? "bg-brand-700 hover:bg-brand-600 text-white border-transparent"
    : danger ? "bg-white text-red-700 border-red-200 hover:bg-red-50"
      : "bg-white text-ink-600 border-line hover:bg-canvas";
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} title={title} aria-busy={busy || undefined}
      className={`min-h-9 flex items-center gap-1.5 px-3 py-1.5 rounded-control border text-xs font-bold whitespace-nowrap disabled:opacity-50 ${look}`}>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function RowMessage({ m }: { m: RowMsg | undefined }) {
  if (!m) return null;
  return (
    <p role={m.tone === "error" ? "alert" : "status"}
      className={`mt-2 text-[12px] rounded-control px-3 py-2 border break-words ${m.tone === "error" ? "text-red-700 bg-red-50 border-red-200" : "text-ink-900 bg-canvas border-line"}`}>
      {m.text}
    </p>
  );
}
