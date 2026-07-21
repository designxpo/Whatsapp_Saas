"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

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

  // New-device 2FA: a second step only appears when the server doesn't
  // recognize this browser for this account.
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Login failed"); return; }
      if (d.pending) { setOtpEmail(d.email || user); setStep("otp"); return; }
      router.push(next);
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/login/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: otpCode }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Invalid code"); return; }
      router.push(next);
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  async function resend() {
    setError(null); setResendMsg(null);
    try {
      const res = await fetch("/api/admin/login/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resend: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Could not resend code"); return; }
      setResendMsg("A new code has been sent.");
    } catch { setError("Connection error"); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      {step === "credentials" ? (
        <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
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
          <input className="w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400" placeholder="Username" value={user} onChange={e => setUser(e.target.value)} autoFocus />
          <input type="password" className="w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
          </button>
          <p className="text-center text-xs text-ink-400">Don&apos;t have an account? <a href="/signup" className="font-semibold text-brand-700 hover:underline">Start free trial</a></p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
          <div className="flex flex-col items-center text-center gap-3">
            <BrandLogo height={44} className="max-w-[220px]" fallback={
              <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
            } />
            <div>
              <h1 className="text-lg font-bold text-ink-900">Verify it&apos;s you</h1>
              <p className="text-sm text-ink-400">We emailed a 4-digit code to {otpEmail} — this browser hasn&apos;t signed in before.</p>
            </div>
          </div>
          <input
            className="w-full border border-line rounded-control px-3 py-2.5 text-center text-2xl font-bold tracking-[0.5em] bg-white text-ink-900 placeholder:text-ink-400 placeholder:tracking-normal placeholder:text-base"
            placeholder="0000" inputMode="numeric" maxLength={4} value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {resendMsg && <p className="text-sm text-emerald-600">{resendMsg}</p>}
          <button disabled={loading || otpCode.length !== 4} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Verify &amp; sign in
          </button>
          <p className="text-center text-xs text-ink-400">
            Didn&apos;t get it? <button type="button" onClick={resend} className="font-semibold text-brand-700 hover:underline">Resend code</button>
            {" · "}
            <button type="button" onClick={() => { setStep("credentials"); setOtpCode(""); setError(null); setResendMsg(null); }} className="font-semibold text-brand-700 hover:underline">Back</button>
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
