"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Loader2, MessageSquare, KeyRound } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

type Step = "credentials" | "otp" | "totp" | "forgot" | "reset";

function LoginForm() {
  const router = useRouter();
  // Optional post-login destination (?next=/support). Same-origin relative
  // paths only — anything else (external URLs, "//host") falls back to /admin.
  const rawNext = useSearchParams().get("next") ?? "";
  // /^\/(?![/\\])/ rejects "//host" AND "/\\host" (URL parsers fold \ into /).
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : "/admin";
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Second step. Which one depends on what the account actually has: an
  // authenticator replaces the emailed code rather than adding to it.
  const [step, setStep] = useState<Step>("credentials");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const [canPasskey, setCanPasskey] = useState(false);
  const [noPasskey, setNoPasskey] = useState(false);
  useEffect(() => { setCanPasskey(browserSupportsWebAuthn()); }, []);

  // Forgotten password.
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const enter = () => { router.push(next); router.refresh(); };

  const post = async (url: string, payload: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Something went wrong");
    return d;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const d = await post("/api/admin/login", { user, password });
      if (d.pending) {
        setOtpEmail(d.email || user);
        setStep(d.factor === "totp" ? "totp" : "otp");
        return;
      }
      enter();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); }
    finally { setLoading(false); }
  }

  async function passkeyLogin() {
    setLoading(true); setError(null); setNoPasskey(false);
    try {
      const optionsJSON = await post("/api/admin/login/passkey/options", {});
      const response = await startAuthentication({ optionsJSON });
      await post("/api/admin/login/passkey/verify", { response });
      enter();
    } catch (err) {
      // A dismissed prompt and "this device holds no passkey for us" arrive as
      // the same NotAllowedError — the browser will not say which, so that a
      // site cannot probe what you have. Treating it purely as "changed their
      // mind" makes the button look dead to everyone who has not set one up.
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "AbortError") { setNoPasskey(true); return; }
      setError(err instanceof Error ? err.message : "Could not use a passkey");
    } finally { setLoading(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await post("/api/admin/login/verify-otp", { code: otpCode });
      enter();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); }
    finally { setLoading(false); }
  }

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await post("/api/admin/login/totp", { code: otpCode });
      enter();
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); setOtpCode(""); }
    finally { setLoading(false); }
  }

  async function resend() {
    setError(null); setResendMsg(null);
    try {
      await post("/api/admin/login/verify-otp", { resend: true });
      setResendMsg("A new code has been sent.");
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); }
  }

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const d = await post("/api/admin/login/forgot", { email: forgotEmail });
      // The same answer whether or not that account exists, so this screen
      // cannot be used to find out who has one.
      setNotice(d.message); setStep("reset");
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); }
    finally { setLoading(false); }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const d = await post("/api/admin/login/forgot/verify", { email: forgotEmail, code: resetCode, password: newPassword });
      setNotice(d.message); setStep("credentials");
      setUser(forgotEmail); setPassword(""); setResetCode(""); setNewPassword("");
    } catch (err) { setError(err instanceof Error ? err.message : "Connection error"); }
    finally { setLoading(false); }
  }

  const card = "w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5";
  const input = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";
  const primary = "w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors";
  const codeInput = "w-full border border-line rounded-control px-3 py-2.5 text-center text-2xl font-bold tracking-[0.5em] bg-white text-ink-900 placeholder:text-ink-400 placeholder:tracking-normal placeholder:text-base";
  const logo = (
    <BrandLogo height={44} className="max-w-[220px]" fallback={
      <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
        <MessageSquare className="w-6 h-6 text-white" />
      </div>
    } />
  );

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      {step === "credentials" && (
        <div className={card}>
          <div className="flex flex-col items-center text-center gap-3">
            <BrandLogo height={44} className="max-w-[220px]" fallback={
              <>
                <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
                  <MessageSquare className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-xl font-bold text-ink-900">Talko AI</h1>
              </>
            } />
            <p className="text-sm text-ink-400">AI conversations for WhatsApp &amp; Instagram</p>
          </div>

          {notice && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-control px-3 py-2">{notice}</p>}

          {canPasskey && (
            <>
              <button onClick={passkeyLogin} disabled={loading}
                className="w-full py-2.5 rounded-control bg-ink-900 hover:bg-ink-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                <KeyRound className="w-4 h-4" /> Sign in with a passkey
              </button>
              {noPasskey && (
                <p className="text-xs text-ink-400 bg-canvas rounded-control px-3 py-2">
                  No passkey on this device yet. Sign in with your password, then add one from your account settings — after that this button works.
                </p>
              )}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] uppercase font-bold text-ink-400">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-5">
            <input className={input} placeholder="Username" value={user} onChange={e => setUser(e.target.value)} autoFocus />
            <input type="password" className={input} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={loading} className={primary}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
            </button>
          </form>
          <button type="button" onClick={() => { setStep("forgot"); setError(null); setNotice(null); setForgotEmail(user); }}
            className="w-full text-xs text-ink-400 hover:text-ink-900">Forgot your password?</button>
          <p className="text-center text-xs text-ink-400">Don&apos;t have an account? <a href="/signup" className="font-semibold text-brand-700 hover:underline">Start free trial</a></p>
        </div>
      )}

      {step === "otp" && (
        <form onSubmit={verifyOtp} className={card}>
          <div className="flex flex-col items-center text-center gap-3">
            {logo}
            <div>
              <h1 className="text-lg font-bold text-ink-900">Verify it&apos;s you</h1>
              <p className="text-sm text-ink-400">We emailed a 4-digit code to {otpEmail} — this browser hasn&apos;t signed in before.</p>
            </div>
          </div>
          <input className={codeInput} placeholder="0000" inputMode="numeric" maxLength={4} value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {resendMsg && <p className="text-sm text-emerald-600">{resendMsg}</p>}
          <button disabled={loading || otpCode.length !== 4} className={primary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Verify &amp; sign in
          </button>
          <p className="text-center text-xs text-ink-400">
            Didn&apos;t get it? <button type="button" onClick={resend} className="font-semibold text-brand-700 hover:underline">Resend code</button>
            {" · "}
            <button type="button" onClick={() => { setStep("credentials"); setOtpCode(""); setError(null); setResendMsg(null); }} className="font-semibold text-brand-700 hover:underline">Back</button>
          </p>
        </form>
      )}

      {step === "totp" && (
        <form onSubmit={verifyTotp} className={card}>
          <div className="flex flex-col items-center text-center gap-3">
            {logo}
            <div>
              <h1 className="text-lg font-bold text-ink-900">Enter your code</h1>
              <p className="text-sm text-ink-400">Open your authenticator app and enter the 6-digit code for this account.</p>
            </div>
          </div>
          <input
            className="w-full border border-line rounded-control px-3 py-2.5 text-center text-2xl font-bold tracking-[0.4em] bg-white text-ink-900 placeholder:text-ink-400 placeholder:tracking-normal placeholder:text-base"
            placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={9}
            value={otpCode} onChange={e => setOtpCode(e.target.value)} autoFocus
          />
          <p className="text-xs text-ink-400 -mt-2">Lost your phone? Enter one of your backup codes instead.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className={primary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Verify &amp; sign in
          </button>
          <p className="text-center text-xs text-ink-400">
            <button type="button" onClick={() => { setStep("credentials"); setOtpCode(""); setError(null); }} className="font-semibold text-brand-700 hover:underline">Back</button>
          </p>
        </form>
      )}

      {step === "forgot" && (
        <form onSubmit={requestReset} className={card}>
          <div className="flex flex-col items-center text-center gap-3">
            {logo}
            <div>
              <h1 className="text-lg font-bold text-ink-900">Reset your password</h1>
              <p className="text-sm text-ink-400">We&apos;ll email a one-time code to your account address.</p>
            </div>
          </div>
          <input className={input} placeholder="Your email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} autoFocus />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className={primary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Send me a code
          </button>
          <p className="text-center text-xs text-ink-400">
            <button type="button" onClick={() => { setStep("credentials"); setError(null); setNotice(null); }} className="font-semibold text-brand-700 hover:underline">Back to sign in</button>
          </p>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={submitReset} className={card}>
          <div className="flex flex-col items-center text-center gap-3">
            {logo}
            <div>
              <h1 className="text-lg font-bold text-ink-900">Choose a new password</h1>
              {notice && <p className="text-sm text-ink-400">{notice}</p>}
            </div>
          </div>
          <input className={codeInput} placeholder="0000" inputMode="numeric" maxLength={4} value={resetCode}
            onChange={e => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus />
          <input type="password" className={input} placeholder="New password (10+ characters)" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <p className="text-xs text-ink-400 -mt-2">If you use an authenticator or a passkey, you&apos;ll still be asked for it when you sign in.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className={primary}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Change my password
          </button>
          <p className="text-center text-xs text-ink-400">
            <button type="button" onClick={() => { setStep("credentials"); setError(null); setNotice(null); }} className="font-semibold text-brand-700 hover:underline">Back to sign in</button>
          </p>
        </form>
      )}
    </main>
  );
}

// useSearchParams (for ?next=) must sit inside a Suspense boundary in Next 15.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
