"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const inp = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#0783fd] focus:ring-2 focus:ring-[#0783fd]/20 transition";

export function AffiliateForm() {
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="w-full py-2.5 rounded-full bg-gradient-to-br from-[#0783fd] via-[#3274ff] to-[#6a5cff] hover:opacity-90 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Join now — it&apos;s free
      </button>
      <p className="text-center text-xs text-slate-400">
        Already enrolled? <a href="/affiliate/login" className="font-semibold text-[#0783fd] hover:underline">Sign in</a>
      </p>
    </form>
  );
}
