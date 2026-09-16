"use client";

// Your own sign-in security: passkeys and an authenticator app.
//
// Deliberately NOT inside Settings. Settings is the workspace — numbers, team,
// billing — and in the sibling internal portal it is admin-only, which meant a
// member could never reach their own second factor at all. A person's own
// credentials belong to them whatever their role, so this tab carries no entry
// in TAB_MIN_ROLE and is visible to everyone.

import { useState, useEffect, useCallback } from "react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Loader2, Plus, Trash2, KeyRound, ShieldCheck, Copy, Check } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";

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
  const [msg, setMsg] = useState<string | null>(null);

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
      if (!res.ok) { setMsg(d.error || "Could not add that passkey"); return; }
      // A device-bound passkey disappears with the device, and this is the only
      // moment anyone is thinking about it.
      if (!d.backedUp) setMsg("Added — but this one lives only on this device. If you lose it, you'll sign in with your password instead.");
      load();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") setMsg(err instanceof Error ? err.message : "Could not add that passkey");
    } finally { setBusy(false); }
  }

  async function removePasskey(p: PasskeyRow) {
    if (!(await ask({
      title: "Remove this passkey?", tone: "danger", confirmLabel: "Remove passkey",
      message: "You can still sign in with your password. Add it again any time from this device.",
      facts: [{ label: "Passkey", value: p.deviceName }],
    }))) return;
    await fetch("/api/admin/passkeys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
    load();
  }

  async function startTotp() {
    setBusy(true); setMsg(null); setBackupCodes([]);
    try {
      const res = await fetch("/api/admin/2fa/setup", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Could not start setup"); return; }
      setQr(d.qr); setSecret(d.secret);
    } finally { setBusy(false); }
  }

  async function confirmTotp() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/2fa/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "That code is not right"); return; }
      setBackupCodes(d.backupCodes ?? []); setQr(""); setSecret(""); setCode("");
      load();
    } finally { setBusy(false); }
  }

  async function disableTotp() {
    if (!(await ask({
      title: "Turn off your authenticator?", tone: "danger", confirmLabel: "Turn it off",
      message: "Sign-in goes back to emailing you a code when you use a new device. Your backup codes stop working.",
    }))) return;
    await fetch("/api/admin/2fa", { method: "DELETE" });
    setBackupCodes([]);
    load();
  }

  async function copyCodes() {
    try { await navigator.clipboard.writeText(backupCodes.join("\n")); setCopied(true); } catch { /* clipboard blocked */ }
  }

  return (
    <div className="space-y-4">
      {/* ── Passkeys ── */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Passkeys</p>
            <p className="text-xs text-slate-500 mt-0.5">Sign in with your fingerprint, face or device PIN — nothing to type, and nothing a fake sign-in page can capture, because your browser only offers a passkey to this exact site.</p>
          </div>
          {canPasskey && pkAvailable && (
            <button onClick={addPasskey} disabled={busy}
              className="shrink-0 px-3 py-1.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add a passkey
            </button>
          )}
        </div>

        {!pkAvailable && <p className="text-xs text-amber-700 bg-amber-50 rounded-control px-3 py-2">Not set up on this deployment — apply migration <code className="font-mono">0117_signin_security.sql</code>.</p>}
        {!canPasskey && <p className="text-xs text-ink-400">This browser doesn&apos;t support passkeys.</p>}
        {canPasskey && pkAvailable && passkeys.length === 0 && (
          <p className="text-xs text-ink-400">No passkeys yet. Add one and you won&apos;t need your password on this device again.</p>
        )}

        {passkeys.map(p => (
          <div key={p.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
            <div className="w-8 h-8 rounded-full bg-ink-900 text-white flex items-center justify-center shrink-0"><KeyRound className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 truncate">
                {p.deviceName}
                <span className="ml-2 text-[10px] font-bold text-ink-400">{p.backedUp ? "· SYNCED" : "· THIS DEVICE ONLY"}</span>
              </p>
              <p className="text-[11px] text-ink-400">
                Added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : " · not used yet"}
              </p>
            </div>
            <button onClick={() => removePasskey(p)} className="shrink-0 p-1.5 rounded-control text-ink-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
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

        {twoFa && !twoFa.available && <p className="text-xs text-amber-700 bg-amber-50 rounded-control px-3 py-2">Not set up on this deployment — apply migration <code className="font-mono">0117_signin_security.sql</code>.</p>}

        {twoFa?.available && !twoFa.enrolled && !qr && backupCodes.length === 0 && (
          <button onClick={startTotp} disabled={busy}
            className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-900 hover:bg-canvas disabled:opacity-60">Set up an authenticator</button>
        )}

        {qr && (
          <div className="space-y-3">
            <p className="text-xs text-ink-500">Scan this, then enter the 6-digit code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Authenticator setup QR code" className="rounded-control border border-line" width={200} height={200} />
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-400">Can&apos;t scan it?</summary>
              <code className="mt-1 block break-all rounded-control bg-canvas border border-line px-3 py-2 text-ink-900">{secret}</code>
            </details>
            <div className="flex gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6}
                className="flex-1 border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400" />
              <button onClick={confirmTotp} disabled={busy || !code.trim()}
                className="shrink-0 px-3 py-2 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 text-white text-xs font-bold disabled:opacity-60">Turn it on</button>
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
            <span className="text-ink-400">{twoFa.backupRemaining} backup code{twoFa.backupRemaining === 1 ? "" : "s"} left</span>
            <button onClick={disableTotp} className="text-ink-400 hover:text-red-600 font-semibold">Turn off</button>
          </div>
        )}

        {msg && <p className="text-xs text-ink-900 bg-canvas rounded-control px-3 py-2">{msg}</p>}
      </section>
    </div>
  );
}
