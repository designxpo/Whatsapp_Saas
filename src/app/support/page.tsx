"use client";

// Support Desk — a focused ticket portal for the internal support workspace
// (talko-support members). Deliberately NOT the full admin: three ticket
// buckets (Unanswered / Open / Closed — needs_reply + the 'closed' label),
// one thread pane, a self-serve profile, and an admin-only Team sheet.
// Data comes from the EXISTING session-tenant-scoped admin APIs, so a support
// member only ever sees their own workspace's conversations.

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Send, LogOut, Users, X, CheckCircle2, RotateCcw, UserCheck,
  MessageSquare, MessageCircle, Instagram, Facebook, Inbox, FileText, Plus,
} from "lucide-react";

// ── Types (mirror the admin conversation API payloads) ───────────────────────
type Ticket = {
  id: string; phone: string; name?: string | null;
  status: "active" | "paused" | "escalated";
  lastMessage?: string | null; lastInboundAt?: string | null; lastOutboundAt?: string | null;
  needsReply?: boolean; labels?: string[]; assignedTo?: string | null;
  platform?: "whatsapp" | "instagram" | "messenger" | "webchat";
  avatarUrl?: string | null; isComment?: boolean;
};
type ThreadMessage = { id: string; role: "user" | "assistant"; body: string; source: "inbound" | "bot" | "agent"; createdAt: string; mediaUrl?: string | null; mediaType?: string | null };
type Profile = { email: string; name: string; title: string; role: "admin" | "member" };
type Bucket = "unanswered" | "open" | "closed";

const inp = "border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400";

// Ticket model on top of wa_conversations (no schema changes):
//   closed     = labels contains 'closed'
//   unanswered = needs_reply && !closed
//   open       = !needs_reply && !closed
const isClosed = (t: Ticket) => (t.labels ?? []).includes("closed");
// needs_reply TRUMPS closed: a customer writing back to a closed ticket must
// surface in Unanswered (matches the closed-banner copy in the thread view).
const bucketOf = (t: Ticket): Bucket => (t.needsReply ? "unanswered" : isClosed(t) ? "closed" : "open");

// Web-chat visitors have an opaque id in `phone` — show a friendlier label.
const contactLabel = (t: { name?: string | null; phone: string; platform?: string }) =>
  t.name || (t.platform === "webchat" ? `Visitor ${t.phone.slice(0, 6)}` : t.phone);

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / (24 * 60))}d`;
}

// Day-divider label for the thread (Today / Yesterday / "12 June 2026").
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
const startsNewDay = (messages: { createdAt: string }[], i: number) =>
  i === 0 || new Date(messages[i - 1].createdAt).toDateString() !== new Date(messages[i].createdAt).toDateString();

// ── Small presentational bits ─────────────────────────────────────────────────
function PlatformBadge({ p }: { p?: Ticket["platform"] }) {
  const map = {
    whatsapp: { icon: <MessageCircle className="w-2.5 h-2.5" />, label: "WhatsApp", cls: "bg-green-50 text-green-700" },
    instagram: { icon: <Instagram className="w-2.5 h-2.5" />, label: "Instagram", cls: "bg-pink-50 text-pink-600" },
    messenger: { icon: <Facebook className="w-2.5 h-2.5" />, label: "Messenger", cls: "bg-blue-50 text-blue-600" },
    webchat: { icon: <MessageSquare className="w-2.5 h-2.5" />, label: "Web chat", cls: "bg-brand-50 text-brand-700" },
  } as const;
  const m = map[p ?? "whatsapp"] ?? map.whatsapp;
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${m.cls}`}>{m.icon} {m.label}</span>;
}

function Avatar({ url, label, size = 36 }: { url?: string | null; label: string; size?: number }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />;
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.4 }} className="rounded-full bg-brand-50 text-brand-700 font-bold flex items-center justify-center shrink-0">
      {(label || "?").replace(/[^a-zA-Z0-9]/g, "").charAt(0).toUpperCase() || "?"}
    </div>
  );
}

// ── Ticket thread (right pane) ────────────────────────────────────────────────
function TicketThread({ id, me, onChanged }: { id: string; me: Profile; onChanged: () => void }) {
  const [conv, setConv] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);   // null = loading
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCount = useRef(0);

  const load = useCallback(() => {
    fetch(`/api/admin/conversations/${id}`).then(r => r.json())
      .then(d => { setConv(d.conversation ?? null); setMessages(d.messages ?? []); })
      .catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Live thread: poll every 5s so visitor messages appear without a refresh.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 5_000);
    return () => clearInterval(t);
  }, [load]);
  // Stick to the bottom when new messages arrive (jump on first paint).
  useEffect(() => {
    const n = messages?.length ?? 0;
    if (n !== prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: prevCount.current === 0 ? "auto" : "smooth" });
      prevCount.current = n;
    }
  }, [messages?.length]);

  // All ticket actions ride the existing conversation API (reply/labels/assign).
  async function act(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? `Failed (HTTP ${res.status})`); return false; }
      load(); onChanged(); return true;
    } catch { setError("Could not reach the server"); return false; }
    finally { setBusy(false); }
  }
  async function sendReply() {
    if (!reply.trim() || busy) return;
    const ok = await act({ action: "reply", body: reply.trim() });   // keep the draft on failure
    if (ok) setReply("");
  }
  const meLabel = me.name || me.email;
  const closed = conv ? isClosed(conv) : false;
  const closeTicket = () => act({ action: "labels", labels: Array.from(new Set([...(conv?.labels ?? []), "closed"])) });
  const reopenTicket = () => act({ action: "labels", labels: (conv?.labels ?? []).filter(l => l !== "closed") });
  const assignMe = () => act({ action: "assign", assignedTo: meLabel });

  if (messages === null) {
    return (
      <section className="flex-1 flex items-center justify-center bg-canvas/40 text-ink-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </section>
    );
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Ticket header: contact + assign/close controls */}
      <div className="h-16 shrink-0 px-5 border-b border-line flex items-center justify-between gap-3 bg-white">
        <div className="min-w-0 flex items-center gap-3">
          <Avatar url={conv?.avatarUrl} label={conv ? contactLabel(conv) : "?"} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-900 truncate leading-tight">{conv ? contactLabel(conv) : "Ticket"}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <PlatformBadge p={conv?.platform} />
              {conv?.status === "escalated" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">ESCALATED</span>}
              {closed && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-canvas text-ink-400">CLOSED</span>}
            </div>
          </div>
        </div>
        {conv && (
          <div className="flex items-center gap-2 shrink-0 text-xs">
            {conv.assignedTo === meLabel
              ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control bg-brand-50 text-brand-700 font-bold"><UserCheck className="w-3.5 h-3.5" /> Assigned to you</span>
              : (
                <>
                  {conv.assignedTo && <span className="text-[11px] font-bold text-ink-400 truncate max-w-[140px]">@{conv.assignedTo}</span>}
                  <button disabled={busy} onClick={assignMe} className="px-2.5 py-1.5 rounded-control border border-line text-ink-600 font-semibold hover:bg-canvas flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" /> Assign to me
                  </button>
                </>
              )}
            {closed
              ? <button disabled={busy} onClick={reopenTicket} className="px-2.5 py-1.5 rounded-control border border-line text-ink-600 font-semibold hover:bg-canvas flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> Reopen</button>
              : <button disabled={busy} onClick={closeTicket} className="px-2.5 py-1.5 rounded-control bg-ink-950 text-white font-semibold hover:opacity-90 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Close ticket</button>}
          </div>
        )}
      </div>

      {/* Thread: oldest → newest; agent/AI replies right-aligned in brand color */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-canvas/60">
        {messages.map((m, i) => {
          const divider = startsNewDay(messages, i)
            ? <div className="flex justify-center my-2"><span className="text-[11px] font-semibold text-ink-500 bg-white border border-line rounded-full px-3 py-1 shadow-sm">{dayLabel(m.createdAt)}</span></div>
            : null;
          const mine = m.role !== "user";
          const mt = m.mediaType ?? "";
          const isImage = !!m.mediaUrl && mt.startsWith("image/");
          // Hide "[image message]"-style placeholders kept for captionless media.
          const hasText = !!m.body.trim() && !(m.mediaUrl && /^\[.*\]$/.test(m.body.trim()));
          return (
            <Fragment key={m.id}>
              {divider}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[72%] rounded-xl px-3.5 py-2 text-sm shadow-sm ${mine ? "bg-brand-700 text-white" : "bg-white border border-line text-ink-900"}`}>
                  {m.mediaUrl && (isImage
                    ? <a href={m.mediaUrl} target="_blank" rel="noreferrer"><img src={m.mediaUrl} alt="" className="rounded-lg max-h-72 max-w-full object-cover mb-1" /></a>
                    : <a href={m.mediaUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-2 underline text-[13px] font-semibold mb-1 ${mine ? "text-white" : "text-brand-700"}`}><FileText className="w-4 h-4" /> Attachment</a>)}
                  {hasText && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <p className={`text-[10px] mt-1 ${mine ? "text-white/60" : "text-ink-400"}`}>
                    {mine ? (m.source === "bot" ? "AI · " : "agent · ") : ""}{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            </Fragment>
          );
        })}
        {messages.length === 0 && <p className="text-center text-ink-400 text-sm py-10">No messages yet.</p>}
        <div ref={bottomRef} />
      </div>

      {/* Reply box — Enter sends, Shift+Enter for a newline */}
      <div className="px-5 py-3 border-t border-line space-y-2 bg-white">
        {error && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">⚠ {error}</p>}
        {closed && <p className="text-[11px] font-semibold text-ink-400 bg-canvas border border-line rounded-control px-3 py-2">This ticket is closed — replying keeps it closed until the customer writes back or you reopen it.</p>}
        <div className="flex items-end gap-2">
          <textarea
            className={`${inp} flex-1 resize-none`} rows={2}
            placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
            value={reply} onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          />
          <button onClick={sendReply} disabled={busy || !reply.trim()} className="px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Profile modal (self-service only: name / title / password) ───────────────
function ProfileModal({ me, onClose, onSaved }: { me: Profile; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/support/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, title, ...(password.trim() ? { password: password.trim() } : {}) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? `Failed (HTTP ${res.status})`); return; }
      onSaved(d.user); onClose();
    } catch { setError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-card border border-line p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-ink-900">My profile</p>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-3">
          <Avatar label={me.name || me.email} size={40} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-900 truncate">{me.email}</p>
            <p className="text-[11px] text-ink-400 capitalize">{me.role}</p>
          </div>
        </div>
        <div className="space-y-2.5">
          <label className="block text-[11px] font-bold text-ink-600">Name
            <input className={`${inp} w-full mt-1`} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </label>
          <label className="block text-[11px] font-bold text-ink-600">Title
            <input className={`${inp} w-full mt-1`} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Support Specialist" />
          </label>
          <label className="block text-[11px] font-bold text-ink-600">New password
            <input type="password" className={`${inp} w-full mt-1`} value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to keep current" autoComplete="new-password" />
          </label>
        </div>
        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        <button onClick={save} disabled={busy || !name.trim()} className="w-full py-2.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save profile
        </button>
      </div>
    </div>
  );
}

// ── Team side-sheet (admin-role only) — reuses the existing team API ─────────
function TeamSheet({ onClose }: { onClose: () => void }) {
  type Member = { id: string; email: string; name: string; title: string; role: "admin" | "member"; active: boolean };
  const [members, setMembers] = useState<Member[] | null>(null);   // null = loading
  const [form, setForm] = useState({ email: "", name: "", role: "member" as "admin" | "member", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/team").then(r => r.json()).then(d => setMembers(d.users ?? [])).catch(() => setMembers([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.email.trim() || !form.password.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? `Failed (HTTP ${res.status})`); return; }
      setForm({ email: "", name: "", role: "member", password: "" });
      load();
    } catch { setError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/40" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white border-l border-line flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="h-14 shrink-0 px-5 border-b border-line flex items-center justify-between">
          <p className="text-sm font-bold text-ink-900 flex items-center gap-2"><Users className="w-4 h-4" /> Team</p>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Members */}
          <div className="space-y-2">
            {members === null && <p className="text-xs text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading members…</p>}
            {members?.map(m => (
              <div key={m.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
                <Avatar label={m.name || m.email} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink-900 truncate">{m.name || m.email}</p>
                  <p className="text-[11px] text-ink-400 truncate">{m.email}{m.title ? ` · ${m.title}` : ""}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${m.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink-400"}`}>{m.role.toUpperCase()}</span>
                {!m.active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">OFF</span>}
              </div>
            ))}
            {members?.length === 0 && <p className="text-xs text-ink-400">No members yet — add your first teammate below.</p>}
          </div>
          {/* Add member */}
          <div className="border-t border-line pt-4 space-y-2.5">
            <p className="text-[11px] font-bold text-ink-600 uppercase tracking-[0.06em]">Add member</p>
            <input className={`${inp} w-full`} placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input className={`${inp} w-full`} placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <div className="flex gap-2">
              <select className={`${inp} flex-1`} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value === "admin" ? "admin" : "member" }))}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <input type="password" className={`${inp} flex-1`} placeholder="Temp password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
            </div>
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <button onClick={add} disabled={busy || !form.email.trim() || !form.password.trim()} className="w-full py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add member
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SupportPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);   // null = loading
  const [tab, setTab] = useState<Bucket>("unanswered");
  const [selected, setSelected] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  // Auth gate: no session → bounce to login and come back here afterwards.
  const kick = useCallback(() => { router.replace("/login?next=/support"); }, [router]);
  useEffect(() => {
    fetch("/api/support/profile")
      .then(r => { if (r.status === 401) { kick(); return null; } return r.json(); })
      .then(d => { if (d?.user) setProfile(d.user); })
      .catch(() => {});
  }, [kick]);

  const load = useCallback(() => {
    fetch("/api/admin/conversations")
      .then(r => { if (r.status === 401) { kick(); throw new Error("unauthorized"); } return r.json(); })
      .then(d => setTickets(((d.conversations ?? []) as Ticket[]).filter(c => !c.isComment)))
      .catch(() => {});
  }, [kick]);
  useEffect(() => { if (profile) load(); }, [profile, load]);
  // Live list: poll every 5s so new tickets and bucket moves show up unattended.
  useEffect(() => {
    if (!profile) return;
    const t = setInterval(() => { if (!document.hidden) load(); }, 5_000);
    return () => clearInterval(t);
  }, [profile, load]);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  const counts: Record<Bucket, number> = { unanswered: 0, open: 0, closed: 0 };
  for (const t of tickets ?? []) counts[bucketOf(t)]++;
  const visible = (tickets ?? []).filter(t => bucketOf(t) === tab);

  // Booting: wait for the profile before painting the desk (avoids a flash).
  if (!profile) {
    return (
      <main className="h-screen flex items-center justify-center bg-canvas text-ink-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-white overflow-hidden">
      {/* ── Slim header ── */}
      <header className="h-14 shrink-0 px-5 border-b border-line flex items-center justify-between bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/brand/talkoai.svg" alt="Talko AI" className="h-7 w-auto" />
          <span className="h-5 w-px bg-line" />
          <p className="text-sm font-bold text-ink-900">Support Desk</p>
        </div>
        <div className="flex items-center gap-2">
          {profile.role === "admin" && (
            <button onClick={() => setShowTeam(true)} className="px-2.5 py-1.5 rounded-control border border-line text-xs font-semibold text-ink-600 hover:bg-canvas flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Team
            </button>
          )}
          <button onClick={() => setShowProfile(true)} title="My profile" className="flex items-center gap-2 px-2 py-1 rounded-control hover:bg-canvas">
            <Avatar label={profile.name || profile.email} size={28} />
            <span className="text-left hidden sm:block">
              <span className="block text-[12px] font-bold text-ink-900 leading-tight">{profile.name || profile.email}</span>
              {profile.title && <span className="block text-[10px] text-ink-400 leading-tight">{profile.title}</span>}
            </span>
          </button>
          <button onClick={logout} title="Log out" className="px-2.5 py-1.5 rounded-control border border-line text-xs font-semibold text-ink-600 hover:bg-canvas flex items-center gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* ── Left: ticket list ── */}
        <aside className="w-80 shrink-0 border-r border-line flex flex-col min-h-0">
          <div className="p-3 border-b border-line">
            <div className="flex gap-1 p-0.5 bg-canvas rounded-control">
              {([["unanswered", "Unanswered"], ["open", "Open"], ["closed", "Closed"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`flex-1 px-1 py-1.5 rounded-[7px] text-[11px] font-bold flex items-center justify-center gap-1 transition-colors ${tab === k ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}>
                  {label} <span className="opacity-60">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tickets === null && (
              <p className="text-center text-ink-400 text-sm py-10 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading tickets…</p>
            )}
            {visible.map(t => (
              <button key={t.id} onClick={() => setSelected(t.id)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-line/60 transition-colors ${selected === t.id ? "bg-brand-50" : "hover:bg-canvas"}`}>
                <Avatar url={t.avatarUrl} label={contactLabel(t)} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-ink-900 truncate">{contactLabel(t)}</p>
                    <span className="text-[10px] text-ink-400 shrink-0">{timeAgo(t.lastInboundAt ?? t.lastOutboundAt)}</span>
                  </div>
                  <p className="text-[12px] text-ink-400 truncate">{t.lastMessage ?? "—"}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <PlatformBadge p={t.platform} />
                    {t.needsReply && !isClosed(t) && <span className="w-2 h-2 rounded-full bg-brand-500" title="awaiting reply" />}
                    {t.status === "escalated" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">ESCALATED</span>}
                    {t.assignedTo && <span className="text-[9px] font-bold text-brand-700 truncate">@{t.assignedTo}</span>}
                  </div>
                </div>
              </button>
            ))}
            {tickets !== null && visible.length === 0 && (
              <div className="flex flex-col items-center gap-2 text-ink-400 py-12">
                <Inbox className="w-6 h-6" />
                <p className="text-sm">{tab === "unanswered" ? "Inbox zero — no tickets awaiting a reply." : tab === "open" ? "No open tickets." : "No closed tickets yet."}</p>
              </div>
            )}
          </div>
        </aside>

        {/* ── Right: selected ticket ── */}
        {selected
          ? <TicketThread key={selected} id={selected} me={profile} onChanged={load} />
          : (
            <section className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-400 bg-canvas/40">
              <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><MessageSquare className="w-6 h-6" /></div>
              <p className="text-sm font-medium">Select a ticket to see the conversation</p>
            </section>
          )}
      </div>

      {showProfile && <ProfileModal me={profile} onClose={() => setShowProfile(false)} onSaved={p => setProfile(p)} />}
      {showTeam && profile.role === "admin" && <TeamSheet onClose={() => setShowTeam(false)} />}
    </main>
  );
}
