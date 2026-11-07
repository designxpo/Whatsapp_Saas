"use client";

// Your own sign-in security: passkeys and an authenticator app.
//
// Deliberately NOT inside Settings. Settings is the workspace — numbers, team,
// billing — and in the sibling internal portal it is admin-only, which meant a
// member could never reach their own second factor at all. A person's own
// credentials belong to them whatever their role, so this tab carries no entry
// in TAB_MIN_ROLE and is visible to everyone.

import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Loader2, Plus, Trash2, KeyRound, ShieldCheck, Copy, Check } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";

type PasskeyRow = { id: string; deviceName: string; backedUp: boolean; createdAt: string; lastUsedAt: string | null };
type TwoFa = { available: boolean; enrolled: boolean; backupRemaining: number };

function deviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

export default function SecurityTab() {
  const ask = useConfirm();
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [pkAvailable, setPkAvailable] = useState(true);
  const [twoFa, setTwoFa] = useState<TwoFa | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setMsg] = useNotice();
  const msg = note?.text ?? null;

  // Authenticator enrolment, in-page.
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setCanPasskey(browserSupportsWebAuthn()); }, []);

  const load = useCallback(() => {
    fetch("/api/admin/passkeys").then(r => r.json()).then(d => { if (!d.error) { setPasskeys(d.passkeys ?? []); setPkAvailable(d.available !== false); } }).catch(() => {});
    fetch("/api/admin/2fa").then(r => r.json()).then(d => { if (!d.error) setTwoFa(d); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addPasskey() {
    setBusy(true); setMsg(null);
    try {
      const optionsJSON = await fetch("/api/admin/passkeys/options", { method: "POST" }).then(r => r.json());
      if (optionsJSON.error) { setMsg(optionsJSON.error); return; }
      const response = await startRegistration({ optionsJSON });
      const res = await fetch("/api/admin/passkeys/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, label: deviceLabel() }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Couldn't add that passkey. Please try again."); return; }
      // A device-bound passkey disappears with the device, and this is the only
      // moment anyone is thinking about it.
      if (!d.backedUp) setMsg("Added — but this one lives only on this device. If you lose it, you'll sign in with your password instead.", "warn");
      else toast("Passkey added — next time, sign in with your fingerprint, face or PIN");
      load();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") setMsg(err instanceof Error ? err.message : "Couldn't add that passkey. Please try again.");
    } finally { setBusy(false); }
  }

  async function removePasskey(p: PasskeyRow) {
    if (!(await ask({
      title: "Remove this passkey?", tone: "danger", confirmLabel: "Remove passkey",
      message: "You can still sign in with your password. Add it again any time from this device.",
      facts: [{ label: "Passkey", value: p.deviceName }],
    }))) return;
    const r = await fetch("/api/admin/passkeys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) }).catch(() => null);
    if (r?.ok) toast(`Passkey for ${p.deviceName} removed`); else toast({ text: "Couldn't remove the passkey. Please try again.", tone: "error" });
    load();
  }

  async function startTotp() {
    setBusy(true); setMsg(null); setBackupCodes([]);
    try {
      const res = await fetch("/api/admin/2fa/setup", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Couldn't start setup. Please try again."); return; }
      setQr(d.qr); setSecret(d.secret);
    } finally { setBusy(false); }
  }

  async function confirmTotp() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/2fa/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "That code isn't right — check the app and try the newest code."); return; }
      setBackupCodes(d.backupCodes ?? []); setQr(""); setSecret(""); setCode("");
      toast("Authenticator app turned on — save your backup codes below");
      load();
    } finally { setBusy(false); }
  }

  async function disableTotp() {
    if (!(await ask({
      title: "Turn off your authenticator?", tone: "danger", confirmLabel: "Turn it off",
      message: "Sign-in goes back to emailing you a code when you use a new device. Your backup codes stop working.",
    }))) return;
    const r = await fetch("/api/admin/2fa", { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast("Authenticator app turned off"); else toast({ text: "Couldn't turn it off. Please try again.", tone: "error" });
    setBackupCodes([]);
    load();
  }

  async function copyCodes() {
    try { await navigator.clipboard.writeText(backupCodes.join("\n")); setCopied(true); toast("Backup codes copied — keep them somewhere safe"); } catch { toast({ text: "Couldn't copy — write the codes down instead.", tone: "error" }); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Sign-in security</h2>
        <p className="text-sm text-slate-500">Make your own sign-in safer and quicker. These settings are just for you, not your whole team.</p>
      </div>
      {/* ── Passkeys ── */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-400 uppercase">Passkeys</p><PageInfo className="text-xs text-slate-500 mt-0.5" lead={<>Sign in with your fingerprint, face or device PIN</>}>Sign in with your fingerprint, face or device PIN — nothing to type, and nothing a fake sign-in page can capture, because your browser only offers a passkey to this exact site.</PageInfo>
          </div>
          {canPasskey && pkAvailable && (
            <button onClick={addPasskey} disabled={busy}
              className="shrink-0 min-h-9 px-3 py-1.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add a passkey
            </button>
          )}
        </div>

        {!pkAvailable && <p className="text-xs text-amber-800 bg-amber-50 rounded-control px-3 py-2">This isn&apos;t available on your workspace yet. If you need it, contact support.</p>}
        {!canPasskey && <p className="text-xs text-ink-500">This browser doesn&apos;t support passkeys. Try the latest Chrome, Safari or Edge.</p>}
        {canPasskey && pkAvailable && passkeys.length === 0 && (
          <p className="text-xs text-ink-500">No passkeys yet. Press <b>Add a passkey</b> and you won&apos;t need your password on this device again.</p>
        )}

        {passkeys.map(p => (
          <div key={p.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
            <div className="w-8 h-8 rounded-full bg-ink-900 text-white flex items-center justify-center shrink-0"><KeyRound className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 sm:truncate">
                {p.deviceName}
                <span className="max-sm:block sm:ml-2 text-[11px] font-bold text-ink-500"><span className="max-sm:hidden" aria-hidden>· </span>{p.backedUp ? "Synced to your other devices" : "This device only"}</span>
              </p>
              <p className="text-[11px] text-ink-500">
                Added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : " · not used yet"}
              </p>
            </div>
            <button onClick={() => removePasskey(p)} aria-label={`Remove passkey for ${p.deviceName}`} title="Remove" className="shrink-0 grid h-9 w-9 place-items-center rounded-control text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </section>

      {/* ── Authenticator app ── */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Authenticator app</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Use a 6-digit code from Google Authenticator, Authy or 1Password instead of the code we email you on a new device. It&apos;s quicker, and there&apos;s nothing sitting in a mailbox for someone else to read.
            </p>
          </div>
          {twoFa?.enrolled && (
            <span className="shrink-0 text-xs font-bold text-emerald-700 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> On</span>
          )}
        </div>

        {twoFa && !twoFa.available && <p className="text-xs text-amber-800 bg-amber-50 rounded-control px-3 py-2">This isn&apos;t available on your workspace yet. If you need it, contact support.</p>}

        {twoFa?.available && !twoFa.enrolled && !qr && backupCodes.length === 0 && (
          <button onClick={startTotp} disabled={busy}
            className="min-h-9 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-900 hover:bg-canvas disabled:opacity-60">Set up an authenticator app</button>
        )}

        {qr && (
          <div className="space-y-3">
            <p className="text-xs text-ink-500">Scan this, then enter the 6-digit code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Authenticator setup QR code" className="rounded-control border border-line" width={200} height={200} />
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-500">Can&apos;t scan it? Type this key into the app instead</summary>
              <code className="mt-1 block break-all rounded-control bg-canvas border border-line px-3 py-2 text-ink-900">{secret}</code>
            </details>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6} aria-label="6-digit code from the app" autoComplete="one-time-code"
                className="flex-1 min-w-0 border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400" />
              <button onClick={confirmTotp} disabled={busy || !code.trim()} title={!code.trim() ? "Enter the 6-digit code first" : undefined}
                className="shrink-0 min-h-10 px-3 py-2 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 text-white text-xs font-bold disabled:opacity-60">Turn it on</button>
            </div>
          </div>
        )}

        {backupCodes.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-ink-900">
              Each of these works <strong>once</strong>, if you ever lose your phone. This is the only time they&apos;re shown.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-control bg-canvas border border-line p-3">
              {backupCodes.map(c => <code key={c} className="text-sm text-ink-900 text-center tracking-wider">{c}</code>)}
            </div>
            <button onClick={copyCodes} className="w-full py-2 rounded-control border border-line text-xs font-bold text-ink-900 flex items-center justify-center gap-2 hover:bg-canvas">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy codes"}
            </button>
          </div>
        )}

        {twoFa?.enrolled && backupCodes.length === 0 && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-ink-500">{twoFa.backupRemaining} backup code{twoFa.backupRemaining === 1 ? "" : "s"} left</span>
            <button onClick={disableTotp} className="min-h-8 px-2 rounded-control text-ink-600 hover:text-red-600 hover:bg-red-50 font-semibold">Turn off</button>
          </div>
        )}

        <Notice notice={note} variant="banner" />
      </section>
    </div>
  );
}
