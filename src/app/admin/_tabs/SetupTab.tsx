"use client";

// Setup & status tab — extracted from admin/page.tsx, lazy-loaded.
import { PageInfo } from "@/components/PageInfo";
import { SetupPacksCard } from "./SetupPacksCard";
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CircleCheck, CircleDashed, ListChecks, Loader2, RefreshCw, X } from "lucide-react";
import { type Tab } from "../_shared";
import { MetaDoctor } from "./MetaDoctor";
import { SITE_URL } from "@/lib/siteurl";

type SetupCheck = { key: string; title: string; status: "ok" | "warn" | "todo" | "error"; detail: string; hint?: string; fixTab?: string; optional?: boolean };
type PlanSummary = { key: string; name: string; includedChannels: { key: string; label: string }[] };

// Matching public guide for each checklist item — only shown while the item
// still needs attention. "kb" and "crm" have no dedicated guide yet, so they
// simply don't get a link rather than pointing somewhere that doesn't exist.
const GUIDE_SLUG: Partial<Record<string, string>> = {
  whatsapp: "connect-whatsapp", instagram: "connect-instagram", messenger: "connect-messenger",
  webchat: "website-chat-widget", ai: "add-your-ai-key",
};

// Self-serve onboarding: each integration verified live, in plain English.
function SetupTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [steps, setSteps] = useState<SetupCheck[] | null>(null);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; detail: string }>>({});

  const load = useCallback(() => {
    setBusy(true); setLoadErr(null);
    fetch("/api/admin/setup/status").then(r => r.json())
      .then(d => { if (d.steps) { setSteps(d.steps); setPlan(d.plan ?? null); } else setLoadErr(d.error || "Couldn't load your setup steps. Press Re-check to try again."); })
      .catch(() => setLoadErr("Couldn't reach the server. Check your connection and press Re-check."))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(target: string) {
    setTesting(target);
    try {
      const d = await fetch("/api/admin/setup/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) }).then(r => r.json());
      setTestResult(prev => ({ ...prev, [target]: { ok: !!d.ok, detail: d.detail || (d.ok ? "Working." : "That didn't work — see the steps above.") } }));
      load();
    } catch { setTestResult(prev => ({ ...prev, [target]: { ok: false, detail: "Couldn't reach the server. Please try again." } })); }
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ListChecks className="w-5 h-5" /> Setup Guide</h2><p className="text-sm text-slate-500">Everything you need to go live, in order: connect your WhatsApp and other channels, add your AI, then test each one. We check every step for you as you go.</p>
        </div>
        <button onClick={load} disabled={busy} className="shrink-0 min-h-9 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-check
        </button>
      </div>

      <SetupPacksCard />

      {plan && (
        <div className="rounded-card border border-brand-100 bg-brand-50 px-4 py-3">
          <p className="text-sm text-ink-900">
            On the <span className="font-extrabold capitalize">{plan.name}</span> plan — we&apos;ll only ask you to set up what it includes.
          </p>
          {plan.includedChannels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.includedChannels.map((c, i) => (
                <span key={c.key} className="rounded-full bg-white border border-brand-200 text-brand-700 text-[11px] font-bold px-2.5 py-0.5">
                  {c.label}{i === 0 ? " · required" : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {steps && (
        <div className="rounded-card border border-line bg-white px-4 py-3 text-sm">
          <span className="font-bold text-ink-900">{doneCount}/{required.length} required steps ready.</span>
          {doneCount < required.length
            ? <span className="text-slate-500"> Finish the items below to go live.</span>
            : <span className="text-emerald-700"> You&apos;re live — customers can message you and the AI will reply.</span>}
        </div>
      )}

      {loadErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{loadErr}</p>}
      {!steps && !loadErr && <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>}

      {/* Owner-only Meta diagnostics — renders nothing for tenant admins. */}
      <MetaDoctor />

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
                  {s.optional && <span className="text-[11px] font-bold text-slate-500 uppercase">optional</span>}
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${m.pill}`}>{m.label}</span>
                </div>
                <p className="text-[13px] text-ink-600 mt-0.5">{s.detail}</p>
                {s.hint && <p className="text-[12px] text-slate-500 mt-1">{s.hint}</p>}
                {tr && <p className={`flex items-start gap-1.5 text-[12px] mt-1 font-medium ${tr.ok ? "text-emerald-700" : "text-red-600"}`}>{tr.ok ? <CircleCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />} <span>{tr.detail}</span></p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-8">
              {s.fixTab && <button onClick={() => goTo(s.fixTab as Tab)} className="min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">{s.status === "ok" ? "Manage" : "Set up"}</button>}
              {canTest && (
                <button onClick={() => test(s.key)} disabled={testing === s.key} className="min-h-9 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
                  {testing === s.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Test now
                </button>
              )}
              {s.status !== "ok" && GUIDE_SLUG[s.key] && (
                <a href={`${SITE_URL}/guides/${GUIDE_SLUG[s.key]}`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center text-[12px] font-bold text-brand-700 hover:underline">
                  Need help connecting this?
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SetupTab;
