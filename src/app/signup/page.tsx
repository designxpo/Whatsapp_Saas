"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const inp = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";
const INDUSTRIES = ["E-commerce / D2C", "Education / EdTech", "Real estate", "Healthcare", "Travel & hospitality", "Financial services", "Agency / Marketing", "SaaS / Tech", "Other"];
const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];
const GOALS = ["Lead generation & sales", "Customer support", "Marketing & broadcasts", "Instagram automation", "E-commerce / catalog", "Appointment booking", "Other"];
const VOLUMES = ["< 1,000 / mo", "1,000–10,000 / mo", "10,000–100,000 / mo", "100,000+ / mo"];

export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState({ company: "", ownerName: "", ownerEmail: "", ownerPhone: "", password: "", industry: INDUSTRIES[0], teamSize: TEAM_SIZES[1], useCase: GOALS[0], expectedVolume: VOLUMES[1] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Signup failed"); return; }
      router.push("/admin?welcome=1");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
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

        <div className="grid grid-cols-2 gap-3">
          <input className={inp} placeholder="Company / brand name" value={f.company} onChange={e => set("company", e.target.value)} autoFocus />
          <input className={inp} placeholder="Your full name" value={f.ownerName} onChange={e => set("ownerName", e.target.value)} />
          <input className={inp} placeholder="Work email" type="email" value={f.ownerEmail} onChange={e => set("ownerEmail", e.target.value)} />
          <input className={inp} placeholder="Phone (WhatsApp)" value={f.ownerPhone} onChange={e => set("ownerPhone", e.target.value)} />
          <input className={`${inp} col-span-2`} type="password" placeholder="Create a password (8+ characters)" value={f.password} onChange={e => set("password", e.target.value)} />
          <label className="text-xs text-ink-400 col-span-2 -mb-2">Tell us a bit about how you'll use it:</label>
          <select className={inp} value={f.industry} onChange={e => set("industry", e.target.value)}>{INDUSTRIES.map(o => <option key={o}>{o}</option>)}</select>
          <select className={inp} value={f.teamSize} onChange={e => set("teamSize", e.target.value)}>{TEAM_SIZES.map(o => <option key={o}>{o}</option>)}</select>
          <select className={inp} value={f.useCase} onChange={e => set("useCase", e.target.value)}>{GOALS.map(o => <option key={o}>{o}</option>)}</select>
          <select className={inp} value={f.expectedVolume} onChange={e => set("expectedVolume", e.target.value)}>{VOLUMES.map(o => <option key={o}>{o}</option>)}</select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="w-full py-2.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Create my account
        </button>
        <p className="text-center text-xs text-ink-400">Already have an account? <a href="/login" className="font-semibold text-brand-700 hover:underline">Sign in</a></p>
      </form>
    </main>
  );
}
