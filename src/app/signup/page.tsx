"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { planFromHref, track } from "@/lib/analytics";

// Match the server email-OTP send cooldown (src/lib/emailotp.ts).
const RESEND_COOLDOWN_SECONDS = 45;

const inp = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";
const INDUSTRIES = ["E-commerce / D2C", "Education / EdTech", "Real estate", "Healthcare", "Travel & hospitality", "Financial services", "Agency / Marketing", "SaaS / Tech", "Other"];
const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];
const GOALS = ["Lead generation & sales", "Customer support", "Marketing & broadcasts", "Instagram automation", "E-commerce / catalog", "Appointment booking", "Other"];
const VOLUMES = ["< 1,000 / mo", "1,000–10,000 / mo", "10,000–100,000 / mo", "100,000+ / mo"];

export default function SignupPage() {
  const router = useRouter();
  // Pricing CTAs arrive as /signup?plan=<Name>, read again here rather than
  // relying on the click event alone so a plan is still attributed when this
  // URL is reached directly — a shared link, a bookmark, a second session.
  //
  // Read from window at event time, NOT via useSearchParams(): that hook opts
  // the whole route out of static prerendering unless it sits under a Suspense
  // boundary, and this is the highest-value page on the site to keep static.
  // The plan is never rendered, only reported, so there is nothing to read it
  // for until an event actually fires.
  const plan = () => planFromHref(typeof window === "undefined" ? null : window.location.href) ?? undefined;
  const [f, setF] = useState({ company: "", ownerName: "", ownerEmail: "", ownerPhone: "", password: "", industry: "", teamSize: "", useCase: "", expectedVolume: "" });
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));

  // Email verification: a second step appears once the form is valid — the
  // tenant/account are only created after the code is confirmed.
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otpCode, setOtpCode] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  // Serialize verification and resending: a resend invalidates the current code.
  const requestInFlight = useRef(false);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (requestInFlight.current) return;
    if (!accept) { setError("Please accept the Terms of Service and Privacy Policy to continue."); return; }
    requestInFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, acceptTerms: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Signup failed"); return; }
      // Funnel step, not the conversion — no account exists until the code is
      // confirmed below. Reported separately so the gap between the two is
      // visible: a large one means the verification email is the leak.
      track("sign_up_start", { plan: plan(), industry: f.industry, team_size: f.teamSize, use_case: f.useCase });
      setVerificationEmail(typeof d.email === "string" ? d.email : f.ownerEmail.trim());
      setStep("otp");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch { setError("Connection error"); }
    finally { requestInFlight.current = false; setLoading(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (requestInFlight.current || otpCode.length !== 4) return;
    requestInFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/signup/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: otpCode }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Invalid code"); return; }
      // THE conversion. Fired before the push, because /admin has no GA tag to
      // fire it from and a navigation can outrun a beacon queued after it.
      track("sign_up", { method: "email", plan: plan() });
      router.push("/admin?welcome=1");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { requestInFlight.current = false; setLoading(false); }
  }

  async function resend() {
    if (requestInFlight.current || resendCooldown > 0) return;
    requestInFlight.current = true; setResending(true);
    setError(null); setResendMsg(null);
    try {
      const res = await fetch("/api/signup/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resend: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Could not resend code"); return; }
      setOtpCode("");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setResendMsg("A new code has been sent. Use the newest email.");
    } catch { setError("Connection error. Please try again."); }
    finally { requestInFlight.current = false; setResending(false); }
  }

  if (step === "otp") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-canvas">
        <form onSubmit={verifyOtp} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
          <div className="flex flex-col items-center text-center gap-3">
            <BrandLogo height={40} className="max-w-[200px]" fallback={
              <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center"><MessageSquare className="w-6 h-6 text-white" /></div>
            } />
            <div>
              <h1 className="text-lg font-bold text-ink-900">Verify your email</h1>
              <p className="text-sm text-ink-400">We emailed a 4-digit code to {verificationEmail} — enter it to finish creating your account.</p>
            </div>
          </div>
          <label htmlFor="signup-code" className="block text-sm font-medium text-ink-700">Verification code</label>
          <input
            id="signup-code" name="code" autoComplete="one-time-code" required aria-describedby="signup-code-help" disabled={loading || resending}
            className={`${inp} text-center text-2xl font-bold tracking-[0.5em] placeholder:tracking-normal placeholder:text-base`}
            placeholder="0000" inputMode="numeric" maxLength={4} value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus
          />
          <p id="signup-code-help" className="text-xs text-ink-500">Check your spam folder too. Only the most recent code works.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {resendMsg && <p role="status" className="text-sm text-emerald-600">{resendMsg}</p>}
          <button disabled={loading || resending || otpCode.length !== 4} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Verify &amp; create account
          </button>
          <p className="text-center text-xs text-ink-400">
            Didn&apos;t get it? <button type="button" onClick={resend} disabled={loading || resending || resendCooldown > 0} className="font-semibold text-brand-700 hover:underline disabled:opacity-60">{resending ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}</button>
            {" · "}
            <button type="button" disabled={loading || resending} onClick={() => { setStep("form"); setOtpCode(""); setError(null); setResendMsg(null); }} className="font-semibold text-brand-700 hover:underline">Back</button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-canvas">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-card border border-line p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <BrandLogo height={40} className="max-w-[200px]" fallback={
            <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center"><MessageSquare className="w-6 h-6 text-white" /></div>
          } />
          <div>
            <h1 className="text-xl font-bold text-ink-900">Start your free 14-day trial</h1>
            <p className="text-sm text-ink-400">WhatsApp + Instagram automation, AI replies, broadcasts & more.</p>
          </div>
        </div>

        <p className="text-xs text-ink-500">No credit card required. Create your account, verify your email, then connect your first channel.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-company">
            <span>Company / brand name</span>
            <input id="signup-company" name="organization" autoComplete="organization" required className={inp} placeholder="Your business" value={f.company} onChange={e => set("company", e.target.value)} autoFocus />
          </label>
          <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-name">
            <span>Your full name</span>
            <input id="signup-name" name="name" autoComplete="name" required className={inp} placeholder="Your name" value={f.ownerName} onChange={e => set("ownerName", e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-email">
            <span>Work email</span>
            <input id="signup-email" name="email" autoComplete="email" required className={inp} placeholder="you@company.com" type="email" value={f.ownerEmail} onChange={e => set("ownerEmail", e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-phone">
            <span>WhatsApp phone <span className="font-normal text-ink-400">(optional)</span></span>
            <input id="signup-phone" name="tel" type="tel" autoComplete="tel" className={inp} placeholder="Include country code, e.g. +91" value={f.ownerPhone} onChange={e => set("ownerPhone", e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-medium text-ink-700 sm:col-span-2" htmlFor="signup-password">
            <span>Password</span>
            <input id="signup-password" name="password" autoComplete="new-password" required minLength={8} aria-describedby="signup-password-help" className={inp} type={showPassword ? "text" : "password"} placeholder="At least 8 characters" value={f.password} onChange={e => set("password", e.target.value)} />
          </label>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <p id="signup-password-help" className="text-xs text-ink-500">Use at least 8 characters.</p>
            <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)} className="text-xs font-semibold text-brand-700 hover:underline">{showPassword ? "Hide password" : "Show password"}</button>
          </div>
        </div>

        <details className="border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-700">Personalize your workspace <span className="font-normal text-xs text-ink-400">(optional)</span></summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-industry"><span>Industry</span><select id="signup-industry" className={inp} value={f.industry} onChange={e => set("industry", e.target.value)}><option value="">Choose if you like</option>{INDUSTRIES.map(o => <option key={o}>{o}</option>)}</select></label>
            <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-team"><span>Team size</span><select id="signup-team" className={inp} value={f.teamSize} onChange={e => set("teamSize", e.target.value)}><option value="">Choose if you like</option>{TEAM_SIZES.map(o => <option key={o}>{o}</option>)}</select></label>
            <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-goal"><span>Main goal</span><select id="signup-goal" className={inp} value={f.useCase} onChange={e => set("useCase", e.target.value)}><option value="">Choose if you like</option>{GOALS.map(o => <option key={o}>{o}</option>)}</select></label>
            <label className="space-y-1 text-xs font-medium text-ink-700" htmlFor="signup-volume"><span>Expected message volume</span><select id="signup-volume" className={inp} value={f.expectedVolume} onChange={e => set("expectedVolume", e.target.value)}><option value="">Choose if you like</option>{VOLUMES.map(o => <option key={o}>{o}</option>)}</select></label>
          </div>
        </details>

        <label className="flex items-start gap-2.5 text-xs text-ink-500 cursor-pointer">
          <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-700 focus:ring-brand-700" />
          <span>
            I agree to Talko AI&apos;s{" "}
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">Terms of Service</a>,{" "}
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">Privacy Policy</a>{" "}and{" "}
            <a href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">Acceptable Use Policy</a>.
          </span>
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={loading || !accept} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create my account
        </button>
        <p className="text-center text-xs text-ink-400">Already have an account? <a href="/login" className="font-semibold text-brand-700 hover:underline">Sign in</a></p>
      </form>
    </main>
  );
}
