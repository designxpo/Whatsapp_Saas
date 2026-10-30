"use client";

// Sign-in for a partner's own staff. Separate from the workspace sign-in at
// /login: different accounts, different session.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand } from "@/components/BrandContext";
import { Notice, useNotice } from "@/components/Notice";

export default function PartnerLoginPage() {
  const brand = useBrand();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); say(null);
    try {
      const r = await fetch("/api/partner/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { say(j.error || "Couldn't sign in."); return; }
      router.push("/partner"); router.refresh();
    } catch { say("Couldn't reach the server."); }
    finally { setBusy(false); }
  }

  const input = "w-full border border-line rounded-control px-3 py-2.5 text-sm bg-white text-ink-900 placeholder:text-ink-400";
  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-card border border-line p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <BrandLogo height={40} className="max-w-[220px]" fallback={<h1 className="text-xl font-bold text-ink-900">{brand.name}</h1>} />
          <div>
            <h1 className="text-lg font-bold text-ink-900">Partner dashboard</h1>
            <p className="text-sm text-ink-400">Manage your customers&apos; workspaces.</p>
          </div>
        </div>
        <Notice notice={note} />
        <input className={input} type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className={input} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button disabled={busy} className="w-full py-2.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
        </button>
        <p className="text-center text-xs text-ink-400">Forgot your password? Ask an owner of your partner account to send you a new invitation.</p>
      </form>
    </main>
  );
}
