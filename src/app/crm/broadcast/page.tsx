"use client";

// Embeddable "broadcast to a list" panel for the CRM (LeadSquared custom tab).
// Open as: /crm/broadcast?token=<CRM_PANEL_TOKEN>[&phones=9199...,9198...]
// LSQ can pass the SmartView segment's phones via the `phones` param, or the rep
// pastes them. Gated by CRM_PANEL_TOKEN.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Send, Megaphone } from "lucide-react";

interface Tpl { name: string; language: string; status: string; components?: { type: string; format?: string; text?: string }[] }

function BroadcastPanel() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const prefill = params.get("phones") ?? "";

  const [recipientsText, setRecipientsText] = useState(prefill.split(",").map(s => s.trim()).filter(Boolean).join("\n"));
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("en_US");
  const [vars, setVars] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch("/api/crm/templates", { headers: { "x-crm-token": token } }).then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, [token]);

  const recipients = useMemo(() => recipientsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [phone, ...rest] = line.split(",");
    return { phone: phone.trim(), name: rest.join(",").trim() };
  }).filter(r => r.phone.replace(/\D/g, "").length >= 10), [recipientsText]);

  const selected = templates.find(t => t.name === tplName && t.language === tplLang);
  const body = selected?.components?.find(c => c.type === "BODY")?.text ?? "";
  const varCount = selected ? new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size : 0;

  async function send() {
    setError(""); setResult("");
    if (!tplName) { setError("Pick a template."); return; }
    if (recipients.length === 0) { setError("Add at least one valid phone."); return; }
    if (!confirm(`Send "${tplName}" to ${recipients.length} lead(s)? This sends real WhatsApp messages.`)) return;
    setSending(true);
    try {
      const res = await fetch("/api/crm/broadcast", {
        method: "POST", headers: { "Content-Type": "application/json", "x-crm-token": token },
        body: JSON.stringify({ templateName: tplName, languageCode: tplLang, variables: vars.split(/\r?\n/).map(v => v.trim()).filter(Boolean), recipients }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) setError(d.error || "Failed"); else setResult(d.message || "Sent.");
    } catch { setError("Failed to reach server"); }
    finally { setSending(false); }
  }

  if (!token) return <div className="p-6 text-sm text-red-600">Missing <code>token</code> in URL.</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 space-y-4 text-slate-800">
      <header className="flex items-center gap-2"><Megaphone className="w-5 h-5 text-brand-700" /><h1 className="font-bold text-sm">WhatsApp broadcast</h1></header>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-slate-400 uppercase">Recipients <span className="text-slate-400 normal-case font-normal">(one per line: phone, name)</span></label>
        <textarea value={recipientsText} onChange={e => setRecipientsText(e.target.value)} rows={5}
          placeholder={"919876543210, Asha\n919812345678, Ravi"}
          className="w-full rounded-card border border-line px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-600" />
        <p className="text-[11px] text-slate-500"><b className="text-brand-700">{recipients.length}</b> valid recipient(s).</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold text-slate-400 uppercase">Template</label>
        <select value={selected ? `${selected.name}|||${selected.language}` : ""}
          onChange={e => { const [n, l] = e.target.value.split("|||"); setTplName(n ?? ""); setTplLang(l ?? "en_US"); setVars(""); }}
          className="w-full rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600">
          <option value="">{templates.length ? "Choose an approved template…" : "No approved templates"}</option>
          {templates.map(t => <option key={t.name + t.language} value={`${t.name}|||${t.language}`}>{t.name} · {t.language}</option>)}
        </select>
        {selected && body && <p className="text-[11px] text-slate-500 bg-white border border-line rounded px-2 py-1.5 whitespace-pre-wrap">{body}</p>}
        {varCount > 0 && (
          <textarea value={vars} onChange={e => setVars(e.target.value)} rows={varCount}
            placeholder={`${varCount} variable value(s), one per line (use {name} for first name)`}
            className="w-full rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
        )}
      </div>

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
      {result && <p className="text-xs text-brand-700 font-semibold bg-brand-50 rounded px-3 py-2">{result}</p>}

      <button onClick={send} disabled={sending} className="w-full rounded-card bg-brand-600 text-white px-4 py-2.5 font-bold disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {recipients.length}
      </button>
    </div>
  );
}

export default function CrmBroadcastPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}>
      <BroadcastPanel />
    </Suspense>
  );
}
