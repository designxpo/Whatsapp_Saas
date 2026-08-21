"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Handshake, Users, Percent, Wallet } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const inp = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";

const POINTS = [
  { icon: Users, title: "Share your link", body: "Every affiliate gets a unique referral link — share it however you already reach people." },
  { icon: Percent, title: "Earn recurring commission", body: "20% of every subscription payment a business you referred makes, for as long as they stay subscribed." },
  { icon: Wallet, title: "Track it in your dashboard", body: "See who you've referred, who's converted to a paying plan, and exactly what's owed to you." },
];

export default function AffiliatePage() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/affiliate/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Signup failed"); return; }
      router.push("/affiliate/dashboard");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-4xl grid md:grid-cols-2 gap-8 items-start">
        <div className="pt-2 space-y-6">
          <div className="flex items-center gap-3">
            <BrandLogo height={32} className="max-w-[160px]" fallback={
              <div className="w-10 h-10 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center"><Handshake className="w-5 h-5 text-white" /></div>
            } />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-ink-900">Refer businesses to Talko AI, earn recurring commission</h1>
            <p className="text-sm text-ink-600 mt-2 leading-relaxed">
              Anyone can join — no Talko AI account required. Get a referral link, and earn a share of every
              subscription payment made by a business you brought in, for as long as they stay a customer.
            </p>
          </div>
          <div className="space-y-4">
            {POINTS.map(p => (
              <div key={p.title} className="flex items-start gap-3">
                <span className="shrink-0 w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center"><p.icon className="w-4.5 h-4.5" /></span>
                <div>
                  <p className="text-sm font-bold text-ink-900">{p.title}</p>
                  <p className="text-[13px] text-ink-600 leading-relaxed">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-card border border-line p-7 space-y-4">
          <div>
            <h2 className="text-base font-bold text-ink-900">Join the affiliate program</h2>
            <p className="text-xs text-ink-400 mt-0.5">Takes under a minute.</p>
          </div>
          <div className="space-y-3">
            <input className={inp} placeholder="Your name" value={f.name} onChange={e => set("name", e.target.value)} required />
            <input className={inp} type="email" placeholder="Email" value={f.email} onChange={e => set("email", e.target.value)} required />
            <input className={inp} type="tel" placeholder="Phone (optional)" value={f.phone} onChange={e => set("phone", e.target.value)} />
            <input className={inp} type="password" placeholder="Password (min 8 characters)" value={f.password} onChange={e => set("password", e.target.value)} required minLength={8} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={loading} className="w-full py-2.5 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create affiliate account
          </button>
          <p className="text-center text-xs text-ink-400">
            Already enrolled? <a href="/affiliate/login" className="font-semibold text-brand-700 hover:underline">Sign in</a>
          </p>
        </form>
      </div>
    </main>
  );
}
