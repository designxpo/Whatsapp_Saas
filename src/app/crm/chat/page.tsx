"use client";

// Embeddable WhatsApp chat panel for the CRM (LeadSquared custom tab / connector).
// Open as: /crm/chat?phone=<lead phone>&token=<CRM_PANEL_TOKEN>&name=<lead name>&agent=<agent email>
// No admin login — gated by CRM_PANEL_TOKEN. Polls the thread every 5s.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Send, MessageSquare, Clock } from "lucide-react";

interface Msg { id: string; role: "user" | "assistant"; body: string; source: string; createdAt: string }
interface Conv { id: string; name: string; phone: string; botEnabled: boolean; status: string }

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
  const [tplParams, setTplParams] = useState("");
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
      setError("");
    } catch { if (initial) setError("Failed to reach server"); }
    finally { setLoading(false); }
  }, [phone, token]);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

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
            ? { templateName: tplName.trim(), templateParams: tplParams.split("|").map(s => s.trim()).filter(Boolean) }
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

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="px-4 py-3 bg-brand-700 text-white flex items-center gap-3 shrink-0">
        <MessageSquare className="w-5 h-5" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{conv?.name || leadName || `+${phone}`}</p>
          <p className="text-[11px] text-white/70">+{phone}</p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${windowOpen ? "bg-brand-500" : "bg-amber-500"}`}>
          {windowOpen ? "24h window open" : "window closed — template only"}
        </span>
      </header>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2">
            <Clock className="w-6 h-6" />
            <p>No conversation yet.</p>
            <p className="text-xs text-center max-w-60">This lead hasn&apos;t messaged us — start with an approved template below.</p>
          </div>
        ) : msgs.map(m => (
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
        {windowOpen && quickReplies.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {quickReplies.map(q => (
              <button key={q.id} onClick={() => setText(q.body)} title={q.body} className="px-2 py-1 rounded-full border border-line text-[11px] font-bold text-slate-600 hover:border-brand-500">/{q.shortcut}</button>
            ))}
          </div>
        )}
        {windowOpen ? (
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
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-amber-700 font-medium">Outside the 24h window — WhatsApp only allows approved templates.</p>
            <div className="flex gap-2">
              <input value={tplName} onChange={e => setTplName(e.target.value)} placeholder="template_name"
                className="w-44 rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
              <input value={tplParams} onChange={e => setTplParams(e.target.value)} placeholder="param1 | param2 (optional)"
                className="flex-1 rounded-card border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600" />
              <button onClick={send} disabled={sending || !tplName.trim()}
                className="rounded-card bg-brand-600 text-white px-4 py-2 disabled:opacity-40">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
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
