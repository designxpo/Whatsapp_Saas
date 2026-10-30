"use client";

// Accept an invitation to a partner's dashboard: choose a password, then go in.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand } from "@/components/BrandContext";
import { Notice, useNotice } from "@/components/Notice";

function SetupForm() {
  const brand = useBrand();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) { say("The two passwords don't match."); return; }
    setBusy(true); say(null);
    try {
      const r = await fetch("/api/partner/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { say(j.error || "Couldn't set your password."); return; }
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
            <h1 className="text-lg font-bold text-ink-900">Choose your password</h1>
            <p className="text-sm text-ink-400">For the {brand.name} partner dashboard. At least 10 characters.</p>
          </div>
        </div>
        {!token && <Notice notice={{ text: "This link is missing its code. Open the link from your invitation email again.", tone: "error" }} />}
        <Notice notice={note} />
        <input className={input} type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} />
        <input className={input} type="password" autoComplete="new-password" placeholder="Same password again" value={again} onChange={e => setAgain(e.target.value)} required minLength={10} />
        <button disabled={busy || !token} className="w-full py-2.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Set password and continue
        </button>
      </form>
    </main>
  );
}

export default function PartnerSetupPage() {
  return <Suspense fallback={null}><SetupForm /></Suspense>;
}
