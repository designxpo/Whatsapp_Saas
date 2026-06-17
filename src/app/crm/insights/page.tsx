"use client";

// Embeddable lead WhatsApp-insights panel for the CRM (LeadSquared custom tab).
// Open as: /crm/insights?phone=<lead phone>&token=<CRM_PANEL_TOKEN>
// No admin login — gated by CRM_PANEL_TOKEN.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, BarChart3, MousePointerClick, Megaphone, Database, Check } from "lucide-react";

interface Insights {
  hasConversation: boolean;
  msgCounts: { inbound: number; outbound: number };
  campaigns: { name: string; status: string; sentAt: string }[];
  clicks: { url: string; clicks: number; at: string | null }[];
  lastInboundAt: string | null; lastOutboundAt: string | null;
  status: string | null; botEnabled: boolean; window: "open" | "closed";
}

function InsightsPanel() {
  const params = useSearchParams();
  const phone = (params.get("phone") ?? "").replace(/\D/g, "");
  const token = params.get("token") ?? "";
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Push-to-CRM controls.
  const [stages, setStages] = useState<string[]>([]);
  const [stage, setStage] = useState("");
  const [taskName, setTaskName] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [crmBusy, setCrmBusy] = useState("");
  const [crmMsg, setCrmMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function crmAction(action: string, extra: Record<string, unknown> = {}) {
    setCrmBusy(action); setCrmMsg(null);
    try {
      const res = await fetch("/api/crm/lead", { method: "POST", headers: { "Content-Type": "application/json", "x-crm-token": token }, body: JSON.stringify({ action, phone, ...extra }) });
      const d = await res.json();
      setCrmMsg(res.ok && d.success ? { ok: true, text: action === "ensure" ? "Lead synced to CRM ✓" : action === "stage" ? "Stage updated ✓" : "Task created ✓" } : { ok: false, text: d.error || "Failed" });
    } catch { setCrmMsg({ ok: false, text: "Connection error" }); }
    finally { setCrmBusy(""); }
  }

  const load = useCallback(async () => {
    if (!phone || !token) return;
    try {
      const res = await fetch(`/api/crm/insights?phone=${phone}`, { headers: { "x-crm-token": token } });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to load"); return; }
      setData(d); setError("");
    } catch { setError("Failed to reach server"); }
    finally { setLoading(false); }
  }, [phone, token]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (token) fetch("/api/crm/lead", { headers: { "x-crm-token": token } }).then(r => r.json()).then(d => setStages(d.stages ?? [])).catch(() => {}); }, [token]);

  if (!phone || !token) return <div className="p-6 text-sm text-red-600">Missing <code>phone</code> or <code>token</code> in URL.</div>;
  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const badge = (s: string) =>
    s === "read" ? "bg-brand-100 text-brand-700" : s === "delivered" ? "bg-brand-50 text-brand-700"
    : s === "sent" ? "bg-slate-100 text-slate-600" : s === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700";

  return (
    <div className="min-h-screen bg-slate-50 p-4 space-y-4 text-slate-800">
      <header className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-brand-700" /><h1 className="font-bold text-sm">WhatsApp insights</h1></header>

      {!data?.hasConversation && <p className="text-xs text-slate-500">No WhatsApp conversation with this lead yet.</p>}

      {/* Push to CRM */}
      <div className="bg-white rounded-xl border border-line p-3 space-y-2.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> Push to CRM</p>
        <div className="flex gap-2">
          <select value={stage} onChange={e => setStage(e.target.value)} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs">
            <option value="">Move to stage…</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => stage && crmAction("stage", { stage })} disabled={!stage || crmBusy === "stage"}
            className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
            {crmBusy === "stage" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Update"}
          </button>
        </div>
        <div className="space-y-1.5">
          <input value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="Follow-up task (e.g. Call back about EMI)"
            className="w-full rounded-lg border border-line px-2 py-1.5 text-xs" />
          <div className="flex gap-2">
            <input value={taskNotes} onChange={e => setTaskNotes(e.target.value)} placeholder="Notes (optional)"
              className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs" />
            <button onClick={() => taskName.trim() && crmAction("task", { taskName, taskNotes })} disabled={!taskName.trim() || crmBusy === "task"}
              className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              {crmBusy === "task" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create task"}
            </button>
          </div>
          <p className="text-[10px] text-slate-400">Task is due tomorrow and lands on the lead&apos;s owner in LeadSquared.</p>
        </div>
        <button onClick={() => crmAction("ensure")} disabled={crmBusy === "ensure"}
          className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-1 disabled:opacity-40">
          {crmBusy === "ensure" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Add / sync this lead to CRM
        </button>
        {crmMsg && <p className={`text-[11px] font-semibold ${crmMsg.ok ? "text-brand-700" : "text-red-600"}`}>{crmMsg.text}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "From lead", value: data?.msgCounts.inbound ?? 0 },
          { label: "Replies", value: data?.msgCounts.outbound ?? 0 },
          { label: "Campaigns", value: data?.campaigns.length ?? 0 },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-line p-3 text-center">
            <p className="text-lg font-extrabold">{s.value}</p>
            <p className="text-[10px] text-slate-500 font-semibold">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-line p-3 text-xs space-y-1">
        <p><span className="text-slate-400">Status:</span> {data?.status ? data.status : "—"} · {data?.botEnabled ? "🤖 AI replying" : "👤 human"} · window <b>{data?.window}</b></p>
        {data?.lastInboundAt && <p><span className="text-slate-400">Last heard from:</span> {new Date(data.lastInboundAt).toLocaleString()}</p>}
        {data?.lastOutboundAt && <p><span className="text-slate-400">Last reply to them:</span> {new Date(data.lastOutboundAt).toLocaleString()}</p>}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Campaigns received</p>
        {(data?.campaigns.length ?? 0) === 0 ? <p className="text-xs text-slate-400">None yet.</p> : (
          <div className="bg-white rounded-xl border border-line divide-y divide-line">
            {data?.campaigns.map((c, i) => (
              <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0"><p className="text-xs font-semibold truncate">{c.name}</p><p className="text-[10px] text-slate-400">{new Date(c.sentAt).toLocaleString()}</p></div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${badge(c.status)}`}>{c.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(data?.clicks.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5" /> Links tapped</p>
          <div className="bg-white rounded-xl border border-line divide-y divide-line">
            {data?.clicks.map((l, i) => (
              <div key={i} className="px-3 py-1.5"><p className="text-xs text-brand-700 truncate">{l.url}</p><p className="text-[10px] text-slate-400">{l.clicks}× {l.at ? `· first ${new Date(l.at).toLocaleString()}` : ""}</p></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CrmInsightsPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}>
      <InsightsPanel />
    </Suspense>
  );
}
