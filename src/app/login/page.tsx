"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, password }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Login failed"); return; }
      router.push("/admin");
      router.refresh();
    } catch { setError("Connection error"); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <BrandMark size={48} className="rounded-control" fallback={
            <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
          } />
          <div>
            <h1 className="text-xl font-bold text-ink-900">Talko AI</h1>
            <p className="text-sm text-ink-400">AI conversations for WhatsApp &amp; Instagram</p>
          </div>
        </div>
        <input className="w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400" placeholder="Username" value={user} onChange={e => setUser(e.target.value)} autoFocus />
        <input type="password" className="w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="w-full py-2.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Sign in
        </button>
      </form>
    </main>
  );
}
