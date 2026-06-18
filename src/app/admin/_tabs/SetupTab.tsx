"use client";

// Setup & status tab — extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CircleCheck, CircleDashed, ListChecks, Loader2, RefreshCw } from "lucide-react";
import { type Tab } from "../_shared";

type SetupCheck = { key: string; title: string; status: "ok" | "warn" | "todo" | "error"; detail: string; hint?: string; fixTab?: string; optional?: boolean };

// Self-serve onboarding: each integration verified live, in plain English.
function SetupTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [steps, setSteps] = useState<SetupCheck[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({});

  const load = useCallback(() => {
    setBusy(true); setLoadErr(null);
    fetch("/api/admin/setup/status").then(r => r.json())
      .then(d => { if (d.steps) setSteps(d.steps); else setLoadErr(d.error || "Could not load setup status."); })
      .catch(() => setLoadErr("Connection error."))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(target: string) {
    setTesting(target);
    try {
      const d = await fetch("/api/admin/setup/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) }).then(r => r.json());
      setTestResult(prev => ({ ...prev, [target]: { ok: !!d.ok, detail: d.detail || (d.ok ? "Working." : "Check failed.") } }));
      load();
    } catch { setTestResult(prev => ({ ...prev, [target]: { ok: false, detail: "Connection error." } })); }
    finally { setTesting(null); }
  }

  const meta: Record<SetupCheck["status"], { pill: string; label: string; icon: string }> = {
    ok:    { pill: "bg-emerald-100 text-emerald-700", label: "Ready",      icon: "text-emerald-600" },
    warn:  { pill: "bg-amber-100 text-amber-700",     label: "Attention",  icon: "text-amber-500" },
    error: { pill: "bg-red-100 text-red-600",         label: "Problem",    icon: "text-red-500" },
    todo:  { pill: "bg-slate-100 text-slate-500",     label: "Not set up", icon: "text-slate-300" },
  };
  const required = (steps ?? []).filter(s => !s.optional);
  const doneCount = required.filter(s => s.status === "ok").length;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ListChecks className="w-5 h-5" /> Setup &amp; status</h2>
          <p className="text-sm text-slate-500">Connect your channels and AI, then confirm each one is live. Every step is checked in real time.</p>
        </div>
        <button onClick={load} disabled={busy} className="shrink-0 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-check
        </button>
      </div>

      {steps && (
        <div className="rounded-card border border-line bg-white px-4 py-3 text-sm">
          <span className="font-bold text-ink-900">{doneCount}/{required.length} required steps ready.</span>
          {doneCount < required.length
            ? <span className="text-slate-500"> Finish the items below to go live.</span>
            : <span className="text-emerald-700"> 🎉 You&apos;re live — customers can message you and the AI will reply.</span>}
        </div>
      )}

      {loadErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{loadErr}</p>}
      {!steps && !loadErr && <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>}

      {(steps ?? []).map(s => {
        const m = meta[s.status];
        const tr = testResult[s.key];
        const canTest = (s.key === "ai" || s.key === "whatsapp" || s.key === "instagram" || s.key === "crm") && s.status !== "todo";
        return (
          <div key={s.key} className="rounded-card border border-line bg-white p-4 space-y-2">
            <div className="flex items-start gap-3">
              {s.status === "ok"
                ? <CircleCheck className={`w-5 h-5 mt-0.5 shrink-0 ${m.icon}`} />
                : s.status === "todo"
                  ? <CircleDashed className={`w-5 h-5 mt-0.5 shrink-0 ${m.icon}`} />
                  : <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${m.icon}`} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink-900">{s.title}</p>
                  {s.optional && <span className="text-[10px] font-bold text-slate-400 uppercase">optional</span>}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.pill}`}>{m.label}</span>
                </div>
                <p className="text-[13px] text-ink-600 mt-0.5">{s.detail}</p>
                {s.hint && <p className="text-[12px] text-slate-500 mt-1">{s.hint}</p>}
                {tr && <p className={`text-[12px] mt-1 font-medium ${tr.ok ? "text-emerald-700" : "text-red-600"}`}>{tr.ok ? "✓ " : "✗ "}{tr.detail}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8">
              {s.fixTab && <button onClick={() => goTo(s.fixTab as Tab)} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">{s.status === "ok" ? "Manage" : "Set up"}</button>}
              {canTest && (
                <button onClick={() => test(s.key)} disabled={testing === s.key} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
                  {testing === s.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Test now
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SetupTab;
