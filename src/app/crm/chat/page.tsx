"use client";

// Embeddable WhatsApp chat panel for the CRM (LeadSquared custom tab / connector).
// Open as: /crm/chat?phone=<lead phone>&token=<CRM_PANEL_TOKEN>&name=<lead name>&agent=<agent email>
// No admin login — gated by CRM_PANEL_TOKEN. Polls the thread every 5s.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Send, MessageSquare, Clock, Sparkles, Instagram } from "lucide-react";

interface Msg { id: string; role: "user" | "assistant"; body: string; source: string; createdAt: string }
interface Conv { id: string; name: string; phone: string; botEnabled: boolean; status: string }
interface Tpl { name: string; language: string; status: string; components?: { type: string; format?: string; text?: string }[] }
interface IgData { conversation: Conv | null; messages: Msg[] }

function ChatPanel() {
  const params = useSearchParams();
  const phone = (params.get("phone") ?? "").replace(/\D/g, "");
  const token = params.get("token") ?? "";
  const leadName = params.get("name") ?? "";
  const agent = params.get("agent") ?? "";

  const [conv, setConv] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("en_US");
  const [tplParams, setTplParams] = useState("");
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [ig, setIg] = useState<IgData | null>(null);
  const [view, setView] = useState<"whatsapp" | "instagram">("whatsapp");
  const [suggesting, setSuggesting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const headers = { "Content-Type": "application/json", "x-crm-token": token };

  const load = useCallback(async (initial = false) => {
    if (!phone || !token) return;
    try {
      const res = await fetch(`/api/crm/thread?phone=${phone}`, { headers: { "x-crm-token": token } });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to load"); return; }
      setConv(d.conversation);
      setMsgs(d.messages ?? []);
      setQuickReplies(d.quickReplies ?? []);
      setWindowOpen(d.window === "open");
      setIg(d.ig ?? null);
      setError("");
    } catch { if (initial) setError("Failed to reach server"); }
    finally { setLoading(false); }
  }, [phone, token]);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, view]);

  // Approved templates for the gallery (load once).
  useEffect(() => {
    if (!token) return;
    fetch("/api/crm/templates", { headers: { "x-crm-token": token } }).then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, [token]);

  // AI-drafted reply the agent can edit before sending (never auto-sent).
  async function suggest() {
    setSuggesting(true); setError("");
    try {
      const d = await fetch("/api/crm/suggest", { method: "POST", headers, body: JSON.stringify({ phone }) }).then(r => r.json());
      if (d.suggestion) setText(d.suggestion); else setError(d.error || "No suggestion available");
    } catch { setError("Failed to reach server"); }
    finally { setSuggesting(false); }
  }

  const selectedTpl = templates.find(t => t.name === tplName && t.language === tplLang);
  const tplBody = selectedTpl?.components?.find(c => c.type === "BODY")?.text ?? "";
  const tplVarCount = selectedTpl ? new Set(Array.from(tplBody.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size : 0;

  async function send() {
    const usingTemplate = !windowOpen;
    if (usingTemplate ? !tplName.trim() : !text.trim()) return;
    setSending(true); setError("");
    try {
      const res = await fetch("/api/crm/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          phone,
          name: leadName,
          agent,
          ...(usingTemplate
            ? { templateName: tplName.trim(), templateLang: tplLang || "en_US", templateParams: tplParams.split("|").map(s => s.trim()).filter(Boolean) }
            : { message: text.trim() }),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Send failed"); return; }
      setText(""); setTplParams("");
      await load();
    } catch { setError("Failed to reach server"); }
    finally { setSending(false); }
  }

  if (!phone || !token) {
    return <div className="p-6 text-sm text-red-600">Missing <code>phone</code> or <code>token</code> in URL. Configure the CRM tab URL as <code>/crm/chat?phone=&#123;&#123;Lead Phone&#125;&#125;&amp;token=&lt;CRM_PANEL_TOKEN&gt;</code>.</div>;
  }

  const onIg = view === "instagram";
  const shown = onIg ? (ig?.messages ?? []) : msgs;

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="px-4 py-3 bg-brand-700 text-white flex items-center gap-3 shrink-0">
        <MessageSquare className="w-5 h-5" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{conv?.name || leadName || `+${phone}`}</p>
          <p className="text-[11px] text-white/70">+{phone}</p>
        </div>
        {ig && (
          <div className="flex rounded-full bg-white/15 p-0.5 text-[11px] font-bold">
            <button onClick={() => setView("whatsapp")} className={`px-2.5 py-1 rounded-full ${view === "whatsapp" ? "bg-white text-brand-700" : "text-white/80"}`}>WhatsApp</button>
            <button onClick={() => setView("instagram")} className={`px-2.5 py-1 rounded-full flex items-center gap-1 ${view === "instagram" ? "bg-white text-brand-700" : "text-white/80"}`}><Instagram className="w-3 h-3" /> IG</button>
          </div>
        )}
        {view === "whatsapp" && (
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${windowOpen ? "bg-brand-500" : "bg-amber-500"}`}>
            {windowOpen ? "24h window open" : "window closed — template only"}
          </span>
        )}
      </header>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2">
            <Clock className="w-6 h-6" />
            <p>No {onIg ? "Instagram" : "WhatsApp"} conversation yet.</p>
            {!onIg && <p className="text-xs text-center max-w-60">This lead hasn&apos;t messaged us — start with an approved template below.</p>}
          </div>
        ) : shown.map(m => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-white border border-line text-slate-800"
              : m.source === "bot" ? "bg-brand-100 text-brand-900"
              : "bg-brand-600 text-white"
            }`}>
              {m.role !== "user" && <p className="text-[9px] font-bold uppercase tracking-wide opacity-70 mb-0.5">{m.source === "bot" ? "AI Assistant" : "Agent"}</p>}
              {m.body}
              <p className={`text-[9px] mt-1 ${m.role === "user" ? "text-slate-400" : "opacity-60"}`}>{new Date(m.createdAt).toLocaleString()}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line bg-white p-3 space-y-2">
        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        {onIg ? (
          <p className="text-xs text-slate-500">📷 Instagram thread (read-only here). Reply from the app&apos;s Live Chat — Instagram doesn&apos;t allow template sends.</p>
        ) : (<>
        {windowOpen && quickReplies.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {quickReplies.map(q => (
              <button key={q.id} onClick={() => setText(q.body)} title={q.body} className="px-2 py-1 rounded-full border border-line text-[11px] font-bold text-slate-600 hover:border-brand-500">/{q.shortcut}</button>
            ))}
          </div>
        )}
        {windowOpen ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <button onClick={suggest} disabled={suggesting} className="flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:underline disabled:opacity-50">
                {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Suggest a reply
              </button>
            </div>
            <div className="flex gap-2">
              <textarea
                value={text} onChange={e => setText(e.target.value)} rows={2}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Type a message… (Enter to send)"
                className="flex-1 resize-none rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <button onClick={send} disabled={sending || !text.trim()}
                className="self-end rounded-card bg-brand-600 text-white px-4 py-2.5 disabled:opacity-40">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-700 font-medium">Outside the 24h window — WhatsApp only allows approved templates.</p>
            <select value={selectedTpl ? `${selectedTpl.name}|||${selectedTpl.language}` : ""}
              onChange={e => { const [n, l] = e.target.value.split("|||"); setTplName(n ?? ""); setTplLang(l ?? "en_US"); setTplParams(""); }}
              className="w-full rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600">
              <option value="">{templates.length ? "Choose an approved template…" : "No approved templates"}</option>
              {templates.map(t => <option key={t.name + t.language} value={`${t.name}|||${t.language}`}>{t.name} · {t.language}</option>)}
            </select>
            {selectedTpl && tplBody && <p className="text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1.5 whitespace-pre-wrap">{tplBody}</p>}
            {tplVarCount > 0 && (
              <input value={tplParams} onChange={e => setTplParams(e.target.value)} placeholder={`${tplVarCount} value(s), separated by |`}
                className="w-full rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
            )}
            <button onClick={send} disabled={sending || !tplName.trim()}
              className="w-full rounded-card bg-brand-600 text-white px-4 py-2 disabled:opacity-40 flex items-center justify-center gap-1.5">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send template
            </button>
          </div>
        )}
        </>)}
        <p className="text-[10px] text-slate-400">Sending from CRM pauses the AI bot for this lead{agent ? ` · signed as ${agent}` : ""}.</p>
      </div>
    </div>
  );
}

export default function CrmChatPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}>
      <ChatPanel />
    </Suspense>
  );
}
