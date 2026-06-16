// "A peek inside Talko AI" — stylized product glimpses to attract users. Pure
// presentational mockups (no real data) in the brand visual language: white
// cards, slate text, blue accents, the analytics gradient. Server-safe.

import {
  MessageSquare, Instagram, Bot, CheckCheck, Users, Megaphone, Search, type LucideIcon,
} from "lucide-react";
import { Container, SectionTitle } from "./ui";
import { Reveal } from "./motion";

function Dots() {
  return <span className="flex gap-1.5">{["#f87171", "#fbbf24", "#34d399"].map(c => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</span>;
}

// ── Unified inbox ─────────────────────────────────────────────────────────────
const CONVOS: { name: string; msg: string; ch: LucideIcon; unread?: number; active?: boolean }[] = [
  { name: "Priya Sharma", msg: "Do you ship to Bangalore?", ch: MessageSquare, unread: 2, active: true },
  { name: "Rohit Verma", msg: "Is the Pro plan available?", ch: Instagram },
  { name: "Sara Mathew", msg: "Thanks, that's perfect! 🙌", ch: MessageSquare },
];
function InboxGlimpse() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(24,119,242,0.45)]">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
        <Dots />
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-400"><Search className="h-3.5 w-3.5" /> Search conversations</div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">● AI active</span>
      </div>
      <div className="grid flex-1 grid-cols-[1.1fr_1.4fr]">
        {/* conversation list */}
        <div className="border-r border-slate-100">
          {CONVOS.map(c => (
            <div key={c.name} className={`flex items-center gap-2.5 px-3.5 py-3 ${c.active ? "bg-[#0783fd]/[0.06]" : ""}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-900 text-[11px] font-bold text-white">{c.name.charAt(0)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[12px] font-bold text-slate-900"><c.ch className="h-3 w-3 text-slate-400" /><span className="truncate">{c.name}</span></div>
                <div className="truncate text-[11px] text-slate-500">{c.msg}</div>
              </div>
              {c.unread && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0783fd] text-[9px] font-bold text-white">{c.unread}</span>}
            </div>
          ))}
        </div>
        {/* active chat */}
        <div className="flex flex-col bg-slate-50/60 p-3.5">
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[11px] text-slate-700 ring-1 ring-slate-100">Do you ship to Bangalore and the Pro price?</div>
          <div className="ml-auto mt-2 max-w-[88%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-brand-600 to-brand-900 px-3 py-2 text-[11px] text-white">Yes — 2–3 days. Pro is ₹4,999/mo with WhatsApp + Instagram and AI replies. Start a free trial? 🚀</div>
          <div className="ml-auto mt-1.5 flex items-center gap-1 text-[9px] font-semibold text-slate-400"><Bot className="h-2.5 w-2.5" /> Auto-replied by AI <CheckCheck className="h-2.5 w-2.5 text-[#0783fd]" /></div>
        </div>
      </div>
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function AnalyticsGlimpse() {
  const bars = [40, 62, 48, 78, 90, 70, 96];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-30px_rgba(24,119,242,0.4)]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-bold text-slate-900"><Users className="h-4 w-4 text-[#0783fd]" /> This week</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">▲ 24%</span>
      </div>
      <div className="mt-4 flex items-end gap-1.5" style={{ height: 64 }}>
        {bars.map((h, i) => <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-brand-600 to-brand-500" style={{ height: `${h}%` }} />)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 p-3 text-white">
          <div className="text-xl font-extrabold">1,284</div>
          <div className="text-[10px] text-white/80">Conversations</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-xl font-extrabold text-slate-900">98%</div>
          <div className="text-[10px] text-slate-500">Open rate</div>
        </div>
      </div>
    </div>
  );
}

// ── Broadcast delivery ──────────────────────────────────────────────────────
function BroadcastGlimpse() {
  const funnel = [["Sent", 100, "bg-brand-900"], ["Delivered", 96, "bg-brand-700"], ["Read", 81, "bg-brand-500"], ["Clicked", 34, "bg-emerald-400"]] as const;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-30px_rgba(24,119,242,0.4)]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-bold text-slate-900"><Megaphone className="h-4 w-4 text-[#0783fd]" /> Diwali offer</span>
        <span className="rounded-full bg-[#0783fd]/10 px-2 py-0.5 text-[10px] font-bold text-[#0783fd]">Sent · 8,200</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {funnel.map(([label, pct, color]) => (
          <div key={label}>
            <div className="flex justify-between text-[10px] font-semibold text-slate-500"><span>{label}</span><span>{pct}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlatformGlimpse() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="A peek inside" title="See Talko AI in action" subtitle="One clean workspace for every conversation, campaign and number — built for teams that move fast." />
      <Reveal className="mt-12 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <InboxGlimpse />
        <div className="flex flex-col gap-5">
          <AnalyticsGlimpse />
          <BroadcastGlimpse />
        </div>
      </Reveal>
    </Container>
  );
}
