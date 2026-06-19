"use client";

// Live Chat: 3-pane chat workspace (conversation list / thread / contact info).
// Extracted from admin/page.tsx, lazy-loaded. ContactProfile is a shared module
// (also used by the Contacts tab). Pure relocation.
import { useState, useEffect, useCallback, useRef } from "react";
import { MessageSquare, Instagram, Search, MessageCircle, LayoutTemplate, X, Loader2, Send, Sparkles, Tag, UserCheck, Mic } from "lucide-react";
import { type Conversation, ConvAvatar, statusBadge, inp, type Tab } from "../_shared";
import { ContactProfile } from "./ContactProfile";

type ThreadMessage = { id: string; role: "user" | "assistant"; body: string; source: "inbound" | "bot" | "agent"; createdAt: string; mediaUrl?: string | null; mediaType?: string | null };

// ── Live Chat: 3-pane chat workspace (list / thread / contact info) ──────────
function LiveChatTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "needs_reply" | "escalated" | "bot_off">("all");
  const [platform, setPlatform] = useState<"all" | "whatsapp" | "instagram">("all");
  const [view, setView] = useState<"chats" | "comments">("chats");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/conversations").then(r => r.ok ? r.json() : { conversations: [] })
      .then(d => setConvos(d.conversations ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const q = search.trim().toLowerCase();
  const onPlatform = (c: Conversation, p: "whatsapp" | "instagram") => (c.platform ?? "whatsapp") === p;
  // Split comment threads (IG comment → AI reply) from real DM chats.
  const chatsCount = convos.filter(c => !c.isComment).length;
  const commentsCount = convos.filter(c => !!c.isComment).length;
  const inView = convos.filter(c => view === "comments" ? !!c.isComment : !c.isComment);
  const visible = inView
    .filter(c => platform === "all" ? true : onPlatform(c, platform))
    .filter(c => filter === "all" ? true : filter === "needs_reply" ? !!c.needsReply : filter === "escalated" ? c.status === "escalated" : !c.botEnabled)
    .filter(c => !q || (c.name ?? "").toLowerCase().includes(q) || c.phone.includes(q));
  const waCount = inView.filter(c => onPlatform(c, "whatsapp")).length;
  const igCount = inView.filter(c => onPlatform(c, "instagram")).length;

  const timeAgo = (iso: string | null) => {
    if (!iso) return "";
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / (24 * 60))}d`;
  };

  return (
    <div className="-m-6 h-[calc(100vh-64px)] flex bg-white overflow-hidden">
      {/* Conversation list */}
      <aside className="w-80 shrink-0 border-r border-line flex flex-col min-h-0">
        <div className="p-4 pb-3 space-y-3 border-b border-line">
          <p className="text-[15px] font-bold text-ink-900">{view === "comments" ? "Comments" : "Live Chat"} <span className="text-xs font-normal text-ink-400">({visible.length})</span></p>
          {/* Chats vs Comments — comment threads (IG comment → AI reply) live in
              their own section so they don't clutter real DM conversations. */}
          <div className="flex gap-1 p-0.5 bg-canvas rounded-control">
            {([["chats", "Chats", chatsCount], ["comments", "Comments", commentsCount]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => { setView(k); setSelected(null); setPlatform("all"); }} className={`flex-1 px-2 py-1.5 rounded-[7px] text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors ${view === k ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}>
                {k === "chats" ? <MessageSquare className="w-3 h-3" /> : <Instagram className="w-3 h-3 text-pink-600" />}
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="w-full border border-line rounded-control pl-8 pr-3 py-2 text-sm bg-canvas text-ink-900 placeholder:text-ink-400" placeholder="Search name or number" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Platform toggle — only for Chats; comments are Instagram-only. */}
          {view === "chats" && (
          <div className="flex gap-1 p-0.5 bg-canvas rounded-control">
            {([["all", "All", inView.length], ["whatsapp", "WhatsApp", waCount], ["instagram", "Instagram", igCount]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => setPlatform(k)} className={`flex-1 px-2 py-1.5 rounded-[7px] text-[11px] font-bold flex items-center justify-center gap-1 transition-colors ${platform === k ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}>
                {k === "whatsapp" && <MessageCircle className="w-3 h-3 text-green-600" />}
                {k === "instagram" && <Instagram className="w-3 h-3 text-pink-600" />}
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          )}
          <div className="flex gap-1 flex-wrap">
            {([["all", "All"], ["needs_reply", "Needs reply"], ["escalated", "Escalated"], ["bot_off", "Human"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${filter === k ? "bg-ink-950 text-white" : "bg-canvas text-ink-400 hover:text-ink-600"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visible.map(c => (
            <button key={c.id} onClick={() => setSelected(c.id)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-line/60 transition-colors ${selected === c.id ? "bg-brand-50" : "hover:bg-canvas"}`}>
              <div className="relative shrink-0 mt-0.5">
                <ConvAvatar url={c.avatarUrl} label={c.name || c.phone} size={36} />
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-line flex items-center justify-center" title={c.platform === "instagram" ? "Instagram" : "WhatsApp"}>
                  {c.platform === "instagram" ? <Instagram className="w-2.5 h-2.5 text-pink-600" /> : <MessageCircle className="w-2.5 h-2.5 text-green-600" />}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink-900 truncate">{c.name || c.phone}</p>
                  <span className="text-[10px] text-ink-400 shrink-0">{timeAgo(c.lastInboundAt ?? c.lastOutboundAt ?? null)}</span>
                </div>
                <p className="text-[12px] text-ink-400 truncate">{c.lastMessage ?? "—"}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {c.needsReply && <span className="w-2 h-2 rounded-full bg-brand-500" title="awaiting reply" />}
                  {c.status === "escalated" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">ESCALATED</span>}
                  {!c.botEnabled && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-canvas text-ink-400">BOT OFF</span>}
                  {c.assignedTo && <span className="text-[9px] font-bold text-brand-700 truncate">@{c.assignedTo}</span>}
                </div>
              </div>
            </button>
          ))}
          {visible.length === 0 && <p className="text-center text-ink-400 text-sm py-10">No conversations{q || filter !== "all" ? " match this filter" : " yet"}.</p>}
        </div>
      </aside>

      {selected
        ? <ChatView key={selected} id={selected} onChanged={load} goTo={goTo} />
        : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-400 bg-canvas/40">
            <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><MessageSquare className="w-6 h-6" /></div>
            <p className="text-sm font-medium">Select a conversation to start chatting</p>
          </div>
        )}
    </div>
  );
}

// Send an approved template from Live Chat — the ONLY message type Meta allows
// outside the 24h window. Scoped to APPROVED templates with no media header and
// no header variable (sendTemplateSingle only fills BODY {{n}}); richer
// templates (media headers etc.) are sent from the Broadcast tab.
function TemplateComposer({ channelId, busy, onSend, onClose }: {
  channelId?: string | null;
  busy: boolean;
  onSend: (p: { templateName: string; languageCode: string; bodyParams: string[]; preview: string }) => void;
  onClose: () => void;
}) {
  type Tpl = { name: string; status: string; language: string; category: string; components?: { type: string; format?: string; text?: string }[] };
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [selKey, setSelKey] = useState("");          // `${name}|${language}`
  const [vars, setVars] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`)
      .then(r => r.json()).then(d => setTpls(d.templates ?? [])).catch(() => setTpls([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  const bodyText = (t: Tpl) => t.components?.find(c => c.type === "BODY")?.text ?? "";
  const varsOf = (t: Tpl) => Math.max(0, ...(bodyText(t).match(/\{\{(\d+)\}\}/g) ?? []).map(m => parseInt(m.replace(/\D/g, ""), 10)));
  // Quick-sendable: no media header, no header variable (we only fill BODY {{n}}).
  const sendable = (t: Tpl) => {
    const h = t.components?.find(c => c.type === "HEADER");
    if (h?.format && h.format !== "TEXT") return false;
    if (h && /\{\{\d+\}\}/.test(h.text ?? "")) return false;
    return true;
  };
  const approved = tpls.filter(t => t.status === "APPROVED");
  const usable = approved.filter(sendable);
  const hiddenCount = approved.length - usable.length;
  const selected = usable.find(t => `${t.name}|${t.language}` === selKey);
  const varCount = selected ? varsOf(selected) : 0;

  function pick(k: string) {
    setSelKey(k);
    const t = usable.find(x => `${x.name}|${x.language}` === k);
    setVars(Array(t ? varsOf(t) : 0).fill(""));
  }
  function preview(): string {
    if (!selected) return "";
    return bodyText(selected).replace(/\{\{(\d+)\}\}/g, (_, d) => vars[Number(d) - 1]?.trim() || `{{${d}}}`);
  }
  const filled = varCount === 0 || vars.slice(0, varCount).every(v => v.trim());

  return (
    <div className="border border-line rounded-control bg-canvas/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink-600 uppercase tracking-[0.06em] flex items-center gap-1.5"><LayoutTemplate className="w-3.5 h-3.5" /> Send approved template</p>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
      </div>
      {loading ? (
        <p className="text-[11px] text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading templates…</p>
      ) : usable.length === 0 ? (
        <p className="text-[11px] text-ink-400">No quick-sendable approved templates{hiddenCount > 0 ? ` (${hiddenCount} with media headers — use the Broadcast tab)` : ""}. Create one in the <b>Templates</b> tab.</p>
      ) : (
        <>
          <select className={`${inp} w-full`} value={selKey} onChange={e => pick(e.target.value)}>
            <option value="">Choose a template…</option>
            {usable.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language} · {t.category}</option>)}
          </select>
          {selected && varCount > 0 && (
            <div className="space-y-1.5">
              {Array.from({ length: varCount }).map((_, i) => (
                <input key={i} className={`${inp} w-full text-xs`} placeholder={`Value for {{${i + 1}}}`} value={vars[i] ?? ""} onChange={e => setVars(prev => { const next = [...prev]; next[i] = e.target.value; return next; })} />
              ))}
            </div>
          )}
          {selected && <p className="text-[12px] text-ink-600 bg-white border border-line rounded-control px-2.5 py-1.5 whitespace-pre-wrap break-words">{preview()}</p>}
          {hiddenCount > 0 && <p className="text-[10px] text-ink-400">{hiddenCount} template{hiddenCount > 1 ? "s" : ""} with media headers hidden — send those from the Broadcast tab.</p>}
          <div className="flex items-center justify-end">
            <button
              onClick={() => selected && onSend({ templateName: selected.name, languageCode: selected.language, bodyParams: vars.slice(0, varCount).map(v => v.trim()), preview: preview() })}
              disabled={busy || !selected || !filled}
              className="px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send template</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Middle thread + right contact-info pane for one conversation.
function ChatView({ id, onChanged, goTo }: { id: string; onChanged: () => void; goTo: (t: Tab) => void }) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [btns, setBtns] = useState<string[]>(["", "", ""]);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [showQuick, setShowQuick] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [team, setTeam] = useState<{ name: string; email: string; title: string }[]>([]);
  const [aiPrompts, setAiPrompts] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [showAssist, setShowAssist] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [aiAgents, setAiAgents] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [actError, setActError] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [contact, setContact] = useState<{ email: string | null; tags: string[]; attributes: Record<string, string> } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCount = useRef(0);

  const load = useCallback(() => {
    fetch(`/api/admin/conversations/${id}`).then(r => r.json()).then(d => { setConv(d.conversation ?? null); setMessages(d.messages ?? []); }).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Live thread: poll every 4s so inbound messages, AI replies, and flow
  // sends appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 4_000);
    return () => clearInterval(t);
  }, [load]);
  // Contact card (tags + attributes collected by flows/forms/AI functions).
  useEffect(() => {
    if (!conv?.phone) return;
    fetch(`/api/admin/contacts?search=${encodeURIComponent(conv.phone)}&limit=1`).then(r => r.json())
      .then(d => { const c = (d.contacts ?? [])[0]; setContact(c ? { email: c.email, tags: c.tags ?? [], attributes: c.attributes ?? {} } : null); })
      .catch(() => {});
  }, [conv?.phone]);
  // Stick to the bottom when new messages arrive (jump on first paint).
  useEffect(() => {
    if (messages.length !== prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: prevCount.current === 0 ? "auto" : "smooth" });
      prevCount.current = messages.length;
    }
  }, [messages.length]);
  useEffect(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQuickReplies(d.quickReplies ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/team/members").then(r => r.json()).then(d => setTeam(d.members ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/prompts").then(r => r.json()).then(d => setAiPrompts((d.prompts ?? []).filter((p: { active: boolean }) => p.active))).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAiAgents(d.agents ?? [])).catch(() => {}); }, []);

  async function applyAssist(promptId: string) {
    if (!reply.trim()) return;
    setAssisting(true);
    try {
      const d = await fetch("/api/admin/ai/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId, text: reply }) }).then(r => r.json());
      if (d.result) setReply(d.result);
    } finally { setAssisting(false); setShowAssist(false); }
  }

  async function act(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setActError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(d.error ?? `Failed (HTTP ${res.status})`); return false; }
      load(); onChanged(); return true;
    } catch { setActError("Could not reach the server"); return false; }
    finally { setBusy(false); }
  }
  async function sendReply() {
    if (!reply.trim()) return;
    const buttons = btns.map(b => b.trim()).filter(Boolean);
    // Keep the draft on failure so the agent can retry without retyping.
    const ok = await act({ action: "reply", body: reply.trim(), ...(buttons.length ? { buttons } : {}) });
    if (ok) { setReply(""); setBtns(["", "", ""]); setShowButtons(false); }
  }
  async function sendTemplate(p: { templateName: string; languageCode: string; bodyParams: string[]; preview: string }) {
    const ok = await act({ action: "template", ...p });
    if (ok) setShowTemplate(false);
  }
  // Free-form replies only deliver inside Meta's 24h window; outside it the agent
  // must send an approved template. WhatsApp only — IG has no template path.
  const windowClosed = !!conv && conv.platform !== "instagram" &&
    (!conv.lastInboundAt || Date.now() - new Date(conv.lastInboundAt).getTime() > 24 * 60 * 60 * 1000);

  return (
    <>
      {/* ── Middle: thread ── */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="h-14 shrink-0 px-5 border-b border-line flex items-center justify-between gap-3 bg-white">
          <div className="min-w-0 flex items-center gap-3">
            <ConvAvatar url={conv?.avatarUrl} label={conv?.name || conv?.phone || "?"} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900 truncate leading-tight">{conv?.name || conv?.phone || "Conversation"}</p>
              {conv && <p className="font-mono text-[11px] text-ink-400 leading-tight">{conv.phone}</p>}
            </div>
            {conv && <span className={statusBadge(conv.status)}>{conv.status}</span>}
          </div>
          {conv && (
            <div className="flex items-center gap-2 shrink-0 text-xs">
              <button disabled={busy} onClick={() => act({ action: "bot", enabled: !conv.botEnabled })}
                className={`px-2.5 py-1.5 rounded-control border font-semibold ${conv.botEnabled ? "border-line text-ink-600 hover:bg-canvas" : "border-brand-700 bg-brand-700 text-white"}`}>
                {conv.botEnabled ? "Turn bot off" : "Turn bot on"}
              </button>
              {conv.status !== "escalated"
                ? <button disabled={busy} onClick={() => act({ action: "status", status: "escalated" })} className="px-2.5 py-1.5 rounded-control border border-red-200 text-red-600 font-semibold hover:bg-red-50">Escalate</button>
                : <button disabled={busy} onClick={() => act({ action: "status", status: "active" })} className="px-2.5 py-1.5 rounded-control border border-line text-ink-600 font-semibold hover:bg-canvas">Mark active</button>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-canvas/60">
          {messages.map(m => {
            // Form lifecycle markers render as status cards, not plain bubbles.
            if (m.body === "[form-abandoned]") {
              return <div key={m.id} className="flex justify-center"><span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">⚠️ Form not completed</span></div>;
            }
            const isComment = m.body.startsWith("[comment] ");
            const body = isComment ? m.body.slice(10) : m.body;
            const submitted = body.startsWith("[form] ");
            const sentMatch = body.match(/^([\s\S]*?)\n\[form:\s*(.+?)\]\s*$/);
            const isAudio = !!m.mediaUrl && (m.mediaType?.startsWith("audio/") ?? false);
            const hasTranscript = isAudio && !!body.trim() && !/^\[.*\]$/.test(body.trim());
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[72%] rounded-xl px-3.5 py-2 text-sm shadow-sm ${submitted ? "bg-emerald-50 border border-emerald-200 text-ink-900" : isComment ? "bg-pink-50 border border-pink-200 text-ink-900" : m.role === "user" ? "bg-white border border-line text-ink-900" : "bg-brand-100 text-ink-900"}`}>
                  {isComment && <p className="text-[10px] font-bold text-pink-600 mb-0.5 flex items-center gap-1"><Instagram className="w-3 h-3" /> {m.role === "user" ? "comment" : "comment reply"}</p>}
                  {isAudio ? (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-ink-400 flex items-center gap-1"><Mic className="w-3 h-3" /> Voice note</p>
                      <audio controls preload="none" src={m.mediaUrl!} className="h-10 w-[240px] max-w-full" />
                      {hasTranscript && <p className="whitespace-pre-wrap break-words text-[13px] text-ink-500 italic">“{body}”</p>}
                    </div>
                  ) : submitted ? (
                    <div>
                      <p className="text-[11px] font-bold text-emerald-700 mb-1">✅ Form submitted</p>
                      <div className="space-y-0.5">
                        {body.slice(7).split(" · ").map((pair, i) => {
                          const idx = pair.indexOf(": ");
                          const k = idx > 0 ? pair.slice(0, idx) : pair;
                          const v = idx > 0 ? pair.slice(idx + 2) : "";
                          return <p key={i} className="text-[12px]"><span className="text-ink-400">{k}:</span> <span className="font-medium">{v}</span></p>;
                        })}
                      </div>
                    </div>
                  ) : sentMatch ? (
                    <div>
                      <p className="whitespace-pre-wrap break-words">{sentMatch[1]}</p>
                      <p className="mt-1 text-[11px] font-bold text-brand-700">📋 Form sent · {sentMatch[2]}</p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{body}</p>
                  )}
                  <p className={`text-[10px] mt-1 ${m.role === "user" ? "text-ink-400" : "text-brand-900/50"}`}>
                    {m.role === "user" ? "" : m.source === "bot" ? "AI · " : "agent · "}{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <p className="text-center text-ink-400 text-sm py-10">No messages yet.</p>}
          <div ref={bottomRef} />
        </div>

        <div className="px-5 py-3 border-t border-line space-y-2 bg-white">
          {actError && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">
              ⚠ {actError}{/Invalid OAuth|access token|credentials not configured/i.test(actError) ? " — WhatsApp (Meta) credentials are not set yet, so messages can't actually send." : ""}
            </p>
          )}
          {windowClosed && (
            <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2 flex items-center justify-between gap-2">
              <span>⏱ Outside WhatsApp&apos;s 24-hour window — free-form replies won&apos;t deliver. Send an approved template to re-open the chat (a paid, business-initiated message).</span>
              {!showTemplate && <button onClick={() => setShowTemplate(true)} className="shrink-0 px-2 py-1 rounded-control bg-amber-600 text-white font-bold hover:bg-amber-700">Send template</button>}
            </div>
          )}
          {showTemplate && conv && (
            <TemplateComposer channelId={conv.channelId} busy={busy} onClose={() => setShowTemplate(false)} onSend={sendTemplate} />
          )}
          {showQuick && quickReplies.length > 0 && (
            <div className="flex gap-1.5 flex-wrap max-h-24 overflow-y-auto">
              {quickReplies.map(q => (
                <button key={q.id} onClick={() => { setReply(q.body); setShowQuick(false); }} title={q.body} className="px-2 py-1 rounded-full border border-line text-[11px] font-bold text-ink-600 hover:border-brand-700">/{q.shortcut}</button>
              ))}
            </div>
          )}
          {showAssist && (
            <div className="flex gap-1.5 flex-wrap">
              {aiPrompts.length === 0 && <p className="text-[11px] text-ink-400">No AI prompts yet — add them in the AI Hub tab.</p>}
              {aiPrompts.map(p => (
                <button key={p.id} onClick={() => applyAssist(p.id)} disabled={assisting || !reply.trim()} className="px-2 py-1 rounded-full border border-brand-100 text-[11px] font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-40">✨ {p.name}</button>
              ))}
            </div>
          )}
          {showButtons && (
            <div className="grid grid-cols-3 gap-2">
              {btns.map((b, i) => (
                <input key={i} className={`${inp} text-xs`} maxLength={20} placeholder={`Button ${i + 1}`} value={b} onChange={e => setBtns(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea className={`${inp} flex-1 resize-none`} rows={2} placeholder="Type a reply… (type / for quick replies, ⌘↵ to send)" value={reply}
              onChange={e => { setReply(e.target.value); if (e.target.value === "/") setShowQuick(true); }}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }} />
            <button onClick={() => setShowQuick(s => !s)} title="Quick replies" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showQuick ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>⚡</button>
            <button onClick={() => setShowAssist(s => !s)} disabled={assisting} title="AI assist (rewrite draft)" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showAssist ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>{assisting ? <Loader2 className="w-4 h-4 animate-spin" /> : "✨"}</button>
            <button onClick={() => setShowButtons(s => !s)} title="Quick-reply buttons" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showButtons ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>⊞</button>
            {conv?.platform !== "instagram" && (
              <button onClick={() => setShowTemplate(s => !s)} title="Send approved template (works outside the 24h window)" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showTemplate ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}><LayoutTemplate className="w-4 h-4" /></button>
            )}
            <button onClick={sendReply} disabled={busy || !reply.trim()} className="px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
            </button>
          </div>
        </div>
      </section>

      {/* ── Right: contact info ── */}
      <aside className="w-80 shrink-0 border-l border-line overflow-y-auto bg-white">
        <div className="p-5 flex flex-col items-center text-center border-b border-line">
          <ConvAvatar url={conv?.avatarUrl} label={conv?.name || conv?.phone || "?"} size={64} />
          <p className="text-[15px] font-bold text-ink-900 mt-2">{conv?.name || "Unknown"}</p>
          <p className="font-mono text-xs text-ink-400">{conv?.phone}</p>
          {contact?.email && <p className="text-xs text-ink-400 mt-0.5">{contact.email}</p>}
          {conv?.phone && (
            <button onClick={() => setShowProfile(true)} className="mt-3 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Sales brief &amp; full profile
            </button>
          )}
        </div>

        <div className="p-4 space-y-4 text-sm">
          {conv && (
            <>
              <div>
                <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Labels</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(conv.labels ?? []).map(l => (
                    <span key={l} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
                      {l}
                      <button disabled={busy} onClick={() => act({ action: "labels", labels: (conv.labels ?? []).filter(x => x !== l) })} className="text-brand-700/50 hover:text-red-500">×</button>
                    </span>
                  ))}
                  <input
                    className="border border-line rounded-full px-2 py-0.5 text-[11px] w-20 focus:outline-none"
                    placeholder="+ label" value={labelInput} onChange={e => setLabelInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && labelInput.trim()) { act({ action: "labels", labels: [...(conv.labels ?? []), labelInput.trim()] }); setLabelInput(""); } }}
                  />
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Assigned to</p>
                <select
                  disabled={busy}
                  className="w-full border border-line rounded-control px-2.5 py-1.5 text-xs focus:outline-none bg-white"
                  value={conv.assignedTo ?? ""}
                  onChange={e => act({ action: "assign", assignedTo: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {/* Keep a legacy free-text assignee selectable until reassigned */}
                  {conv.assignedTo && !team.some(m => m.name === conv.assignedTo) && (
                    <option value={conv.assignedTo}>{conv.assignedTo}</option>
                  )}
                  {team.map(m => (
                    <option key={m.email} value={m.name}>{m.name}{m.title ? ` — ${m.title}` : ""}</option>
                  ))}
                </select>
                {(() => { const m = team.find(x => x.name === conv.assignedTo); return m?.title ? <p className="text-[11px] text-ink-400 mt-1">{m.title}</p> : null; })()}
              </div>

              {aiAgents.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> AI persona</p>
                  <select
                    disabled={busy}
                    className="w-full border border-line rounded-control px-2.5 py-1.5 text-xs focus:outline-none bg-white"
                    value={conv.agentId ?? ""}
                    onChange={e => act({ action: "agent", agentId: e.target.value || null })}
                  >
                    <option value="">Auto / default{(() => { const a = aiAgents.find(x => x.active); return a ? ` (${a.name})` : ""; })()}</option>
                    {aiAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {contact && contact.tags.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Contact tags</p>
              <div className="flex gap-1.5 flex-wrap">
                {contact.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-canvas text-ink-600 text-[11px] font-semibold">{t}</span>)}
              </div>
            </div>
          )}

          {contact && Object.keys(contact.attributes).length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Details collected</p>
              <div className="border border-line rounded-control divide-y divide-line">
                {Object.entries(contact.attributes).map(([k, v]) => (
                  <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                    <span className="text-[11px] text-ink-400 capitalize shrink-0">{k.replaceAll("_", " ")}</span>
                    <span className="text-[12px] text-ink-900 font-medium text-right break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
      {showProfile && conv?.phone && <ContactProfile phone={conv.phone} onClose={() => setShowProfile(false)} onChanged={() => { load(); onChanged(); }} goTo={goTo} />}
    </>
  );
}

export default LiveChatTab;
