"use client";

// Meta connection doctor (platform owner only) — shared by the Owner Portal and
// the tenant admin Setup tab. Diagnoses why "Connect with Facebook" / channel
// webhooks aren't working: missing vs SET-BUT-EMPTY env vars, live Graph
// credential validation, and the exact callback URLs to paste into the Meta
// app. Tenant admins get a 403 from the API, so the panel renders nothing.
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CircleCheck, Loader2, RefreshCw, Stethoscope } from "lucide-react";

type DoctorCheck = { key: string; title: string; status: "ok" | "warn" | "error"; detail: string; hint?: string };

export function MetaDoctor() {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(() => {
    setBusy(true);
    fetch("/api/admin/setup/meta-doctor").then(async r => {
      if (r.status === 403 || r.status === 401) { setHidden(true); return; }
      const d = await r.json();
      setChecks(d.checks ?? []);
    }).catch(() => setChecks([])).finally(() => setBusy(false));
  }, []);
  useEffect(() => { run(); }, [run]);

  if (hidden) return null;
  const tone = { ok: "text-emerald-600", warn: "text-amber-500", error: "text-red-500" } as const;
  const pill = { ok: "bg-emerald-100 text-emerald-700", warn: "bg-amber-100 text-amber-700", error: "bg-red-100 text-red-600" } as const;

  return (
    <div className="rounded-card border border-line bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5"><Stethoscope className="w-4 h-4 text-brand-700" /> Meta connection doctor <span className="text-[10px] font-bold text-slate-400 uppercase">owner</span></p>
          <p className="text-[12px] text-slate-500 mt-0.5">Why “Connect with Facebook” or a webhook isn’t working — env by env, plus a live Graph credential check.</p>
        </div>
        <button onClick={run} disabled={busy} className="shrink-0 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-run
        </button>
      </div>
      {!checks && <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>}
      {checks?.map(c => (
        <div key={c.key} className="flex items-start gap-2.5 border-t border-line/60 pt-2.5">
          {c.status === "ok" ? <CircleCheck className={`w-4 h-4 mt-0.5 shrink-0 ${tone[c.status]}`} /> : <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${tone[c.status]}`} />}
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-ink-900 flex items-center gap-2">{c.title} <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pill[c.status]}`}>{c.status === "ok" ? "Ready" : c.status === "warn" ? "Check" : "Problem"}</span></p>
            <p className="text-[12px] text-ink-600 mt-0.5 break-all">{c.detail}</p>
            {c.hint && <p className="text-[12px] text-slate-500 mt-0.5">{c.hint}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
