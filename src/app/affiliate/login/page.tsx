"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Handshake } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const inp = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";

export default function AffiliateLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/affiliate/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Login failed"); return; }
      router.push("/affiliate/dashboard");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-canvas">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <BrandLogo height={40} className="max-w-[200px]" fallback={
            <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center"><Handshake className="w-6 h-6 text-white" /></div>
          } />
          <div>
            <h1 className="text-lg font-bold text-ink-900">Affiliate sign in</h1>
            <p className="text-sm text-ink-400">Check your referrals and commission.</p>
          </div>
        </div>
        <div className="space-y-3">
          <input className={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
          <input className={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
        </button>
        <p className="text-center text-xs text-ink-400">
          Not an affiliate yet? <a href="/affiliate" className="font-semibold text-brand-700 hover:underline">Join the program</a>
        </p>
      </form>
    </main>
  );
}
