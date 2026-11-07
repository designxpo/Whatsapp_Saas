"use client";

// The affiliate's payout account: where their commission is sent. Reads only
// the masked status (kind + last 4 digits); the full account is never sent
// back to the browser. Saving a new account needs the current password, starts
// a 7-day wait before any payout, and emails the affiliate about the change.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wallet, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { HeaderRow, ActionRow } from "@/components/header-row";
import { SegmentedControl } from "@/components/SegmentedControl";

type AccountStatus = {
  configured: boolean; kind: "upi" | "bank" | null; last4: string | null; name: string | null;
  verified: boolean; changedAt: string | null; cooldownEndsAt: string | null;
  status: "none" | "pending_verification" | "verified";
};
type Kind = "upi" | "bank";

const STATUS_WORDS: Record<AccountStatus["status"], { text: string; cls: string }> = {
  none: { text: "No payout account yet", cls: "bg-canvas text-ink-600 border-line" },
  pending_verification: { text: "Waiting for verification", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  verified: { text: "Verified", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const field = "w-full rounded-control border border-line px-3 py-2.5 text-sm text-ink-900 bg-white focus:border-brand-500";
const labelCls = "block text-[12px] font-bold text-ink-900 mb-1";

function longDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function PayoutAccountCard({ commissionPct }: { commissionPct: number }) {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<Kind>("upi");
  const [vpa, setVpa] = useState("");
  const [acct, setAcct] = useState("");
  const [acct2, setAcct2] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/affiliate/payout-details", { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { account?: AccountStatus; error?: string };
      if (!r.ok || j.error || !j.account) { setLoadErr(j.error || `Couldn't load your payout account (HTTP ${r.status})`); return; }
      setLoadErr(null); setAccount(j.account);
    } catch { setLoadErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setVpa(""); setAcct(""); setAcct2(""); setIfsc(""); setPassword(""); setErr(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setSaved(null);
    if (kind === "upi" && !vpa.trim()) { setErr("Enter your UPI ID."); return; }
    if (kind === "bank") {
      if (!acct.trim()) { setErr("Enter your bank account number."); return; }
      if (acct.replace(/\s/g, "") !== acct2.replace(/\s/g, "")) { setErr("The two account numbers do not match."); return; }
      if (!ifsc.trim()) { setErr("Enter your bank's IFSC code."); return; }
    }
    if (!password) { setErr("Enter your current password."); return; }
    const body = kind === "upi"
      ? { kind, vpa: vpa.trim(), password }
      : { kind, accountNumber: acct.trim(), ifsc: ifsc.trim(), password };
    setBusy(true);
    try {
      const r = await fetch("/api/affiliate/payout-details", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as { account?: AccountStatus; error?: string };
      if (!r.ok || j.error || !j.account) { setErr(j.error || `Couldn't save (HTTP ${r.status})`); setPassword(""); return; }
      setAccount(j.account);
      resetForm(); setEditing(false);
      setSaved("Saved. We have emailed you about this change.");
    } catch {
      setErr("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const st = account ? STATUS_WORDS[account.status] : null;
  const masked = account?.kind
    ? `${account.kind === "upi" ? "UPI ID" : "Bank account"} ending ${account.last4 ?? "----"}`
    : null;
  const showForm = editing || account?.status === "none";

  return (
    <section className="bg-white rounded-card border border-line overflow-hidden">
      <header className="px-4 py-3 border-b border-line">
        <HeaderRow actions={account && account.status !== "none" && !editing && (
          <button type="button" onClick={() => { setSaved(null); resetForm(); setEditing(true); }}
            className="min-h-9 px-3 rounded-control border border-line bg-white text-xs font-bold text-ink-600 hover:bg-canvas">
            Change payout account
          </button>
        )}>
          <h2 className="text-[13px] font-extrabold text-ink-900 flex items-center gap-1.5"><Wallet className="w-4 h-4 text-ink-400" /> Payout account</h2>
        </HeaderRow>
      </header>

      <div className="p-4 space-y-4">
        <div className="rounded-control bg-canvas border border-line px-3 py-2.5 text-[12px] text-ink-600 leading-relaxed">
          <p className="font-bold text-ink-900 mb-0.5">How payouts work</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>You earn {commissionPct}% of what each business you refer pays.</li>
            <li>Commission becomes payable 10 days after your referral pays.</li>
            <li>The minimum payout is ₹500.</li>
            <li>Payouts are reviewed and sent by the Talko team to the account below.</li>
          </ul>
        </div>

        {loadErr && <p role="alert" className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2">{loadErr}</p>}
        {!account && !loadErr && <p className="flex items-center gap-2 text-[13px] text-ink-600"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}

        {account && st && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${st.cls}`}>
                {account.status === "verified" && <ShieldCheck className="w-3 h-3" />}{st.text}
              </span>
              {masked && <span className="text-sm font-bold text-ink-900 break-words">{masked}{account.name ? ` · ${account.name}` : ""}</span>}
            </div>
            {account.status === "pending_verification" && (
              <p className="text-[12px] text-ink-600">The Talko team checks every new account before the first payout to it.</p>
            )}
            {account.cooldownEndsAt && (
              <p className="text-[12px] text-ink-600 flex items-start gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>For your security, payouts start 7 days after a change. Payouts to this account can start on <b className="text-ink-900">{longDate(account.cooldownEndsAt)}</b>.</span>
              </p>
            )}
          </div>
        )}

        {saved && <p role="status" className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-control px-3 py-2">{saved}</p>}

        {account && showForm && (
          <form onSubmit={save} className="space-y-3 border-t border-line pt-4" autoComplete="off">
            <p className="text-[13px] font-bold text-ink-900">{account.status === "none" ? "Add your payout account" : "Change your payout account"}</p>
            <SegmentedControl<Kind> ariaLabel="Payout method" value={kind} onChange={k => { setKind(k); setErr(null); }}
              options={[{ value: "upi", label: "UPI ID" }, { value: "bank", label: "Bank account" }]} />

            {kind === "upi" ? (
              <div>
                <label htmlFor="po-vpa" className={labelCls}>UPI ID</label>
                <input id="po-vpa" value={vpa} onChange={e => setVpa(e.target.value)} placeholder="name@bank"
                  autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" className={field} />
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="po-acct" className={labelCls}>Account number</label>
                  <input id="po-acct" value={acct} onChange={e => setAcct(e.target.value)} inputMode="numeric"
                    autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
                </div>
                <div>
                  <label htmlFor="po-acct2" className={labelCls}>Account number again</label>
                  <input id="po-acct2" value={acct2} onChange={e => setAcct2(e.target.value)} inputMode="numeric"
                    autoComplete="off" spellCheck={false} onPaste={e => e.preventDefault()} className={`${field} font-mono`} />
                  {acct2 && acct.replace(/\s/g, "") !== acct2.replace(/\s/g, "") && (
                    <p className="text-[11px] text-amber-700 mt-1">The two account numbers do not match yet.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="po-ifsc" className={labelCls}>IFSC code</label>
                  <input id="po-ifsc" value={ifsc} onChange={e => setIfsc(e.target.value.toUpperCase())} placeholder="SBIN0001234"
                    maxLength={11} autoCapitalize="characters" autoCorrect="off" spellCheck={false} className={`${field} font-mono`} />
                </div>
              </>
            )}

            <div>
              <label htmlFor="po-pw" className={labelCls}>Your current password</label>
              <input id="po-pw" type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" className={field} />
              <p className="text-[11px] text-ink-600 mt-1">Needed to change where your money goes. We email you after every change.</p>
            </div>

            {err && (
              <p role="alert" className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{err}</span>
              </p>
            )}

            <ActionRow>
              <button type="submit" disabled={busy}
                className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save payout account
              </button>
              {account.status !== "none" && (
                <button type="button" disabled={busy} onClick={() => { resetForm(); setEditing(false); }}
                  className="min-h-10 px-4 rounded-control border border-line bg-white text-sm font-semibold text-ink-600 hover:bg-canvas disabled:opacity-60">
                  Cancel
                </button>
              )}
            </ActionRow>
          </form>
        )}
      </div>
    </section>
  );
}
