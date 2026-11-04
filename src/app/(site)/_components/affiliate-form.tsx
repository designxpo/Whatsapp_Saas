"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { track } from "@/lib/analytics";

const inp = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-[#0783fd] focus:ring-2 focus:ring-[#0783fd]/20 transition";

export function AffiliateForm() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  // Unticked by default — joining requires an active choice to accept the terms.
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted) { setError("Please accept the Terms of Service and Privacy Policy to continue."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/affiliate/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, acceptTerms: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Signup failed"); return; }
      // Before the push: the dashboard is outside the (site) group and carries
      // no tag, so an event queued after navigating would never be sent.
      // Event name only — never the name, email or phone typed above.
      track("affiliate_signup");
      router.push("/affiliate/dashboard");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-900">Join the affiliate program</h2>
        <p className="text-xs text-slate-400 mt-0.5">Free to join. Takes under a minute.</p>
      </div>
      <div className="space-y-3">
        <input className={inp} placeholder="Your name" value={f.name} onChange={e => set("name", e.target.value)} required />
        <input className={inp} type="email" placeholder="Email" value={f.email} onChange={e => set("email", e.target.value)} required />
        <input className={inp} type="tel" placeholder="Phone (optional)" value={f.phone} onChange={e => set("phone", e.target.value)} />
        <input className={inp} type="password" placeholder="Password (min 8 characters)" value={f.password} onChange={e => set("password", e.target.value)} required minLength={8} />
      </div>
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
        <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-[#0783fd]" />
        <span>
          I agree to the{" "}
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#026cd4] underline hover:no-underline">Terms of Service</a>{" "}
          and{" "}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#026cd4] underline hover:no-underline">Privacy Policy</a>
        </span>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading || !accepted} className="marketing-button marketing-button-primary w-full disabled:opacity-60">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Join now — it&apos;s free
      </button>
      <p className="text-center text-xs text-slate-400">
        Already enrolled? <a href="/affiliate/login" className="font-semibold text-[#026cd4] hover:underline">Sign in</a>
      </p>
    </form>
  );
}
