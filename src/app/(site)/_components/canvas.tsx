// n8n-style horizontal agent canvas. Shows what ONE automation actually looks
// like in the builder: a trigger → an AI Agent (with model / memory / knowledge /
// tools hanging beneath it) → a router → channel actions on each branch. Light
// theme, brand blue, dotted backdrop, animated dashed connectors. Server-safe
// (Reveal is the only client piece). Sized to fit a desktop viewport without
// horizontal scroll; falls back to a scrollable canvas only on narrow screens.

import {
  Zap, Bot, Sparkles, History, BookOpen, ShoppingBag, Split, UserPlus, Bell,
  MessageSquare, Repeat, type LucideIcon,
} from "lucide-react";
import { SectionTitle } from "./ui";
import { Reveal } from "./motion";
import { AGENT_CANVAS, type CanvasNode } from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  zap: Zap, bot: Bot, sparkles: Sparkles, history: History, book: BookOpen,
  shopping: ShoppingBag, split: Split, user: UserPlus, bell: Bell,
  message: MessageSquare, repeat: Repeat,
};
function Ico({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Bot;
  return <I className={className} />;
}

// A draggable-looking node card (with the little connector dots n8n shows).
function Node({ node, dots = "x", className = "w-40" }: { node: CanvasNode; dots?: "x" | "in" | "out" | "io"; className?: string }) {
  const showIn = dots === "in" || dots === "io";
  const showOut = dots === "out" || dots === "io";
  return (
    <div className={`relative shrink-0 rounded-2xl border bg-white p-3 shadow-[0_12px_30px_-16px_rgba(24,119,242,0.45)] ${node.accent ? "border-[#0783fd] ring-1 ring-[#0783fd]/20" : "border-slate-200"} ${className}`}>
      {showIn && <span aria-hidden className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      {showOut && <span aria-hidden className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${node.accent ? "bg-[#0783fd] text-white animate-pulsesoft" : "bg-[#0783fd]/10 text-[#0783fd]"}`}>
          <Ico name={node.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold leading-tight text-slate-900">{node.title}</div>
          {node.sub && <div className="truncate text-[10.5px] text-slate-500">{node.sub}</div>}
        </div>
      </div>
    </div>
  );
}

// Animated dashed horizontal connector between stages.
function Wire({ label, width = 44 }: { label?: string; width?: number }) {
  return (
    <div className="relative flex shrink-0 items-center" style={{ width }}>
      <svg width={width} height="24" viewBox={`0 0 ${width} 24`} className="overflow-visible">
        <line x1="0" y1="12" x2={width - 8} y2="12" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
        <path d={`M${width - 8} 7 L${width} 12 L${width - 8} 17 Z`} fill="#0783fd" fillOpacity="0.7" />
      </svg>
      {label && <span className="absolute -top-3.5 left-1 rounded-full bg-[#0783fd]/10 px-2 py-0.5 text-[10px] font-bold text-[#0783fd]">{label}</span>}
    </div>
  );
}

export function AgentCanvas() {
  const c = AGENT_CANVAS;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
      <SectionTitle
        eyebrow="Build it visually"
        title="One canvas. Every conversation, automated."
        subtitle="Connect a trigger, drop in an AI agent with your model, memory and tools, then route every message to the right outcome — no code, no engineers."
      />
      <Reveal className="relative mt-12">
        {/* Dotted canvas backdrop, like the builder. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] [background-image:radial-gradient(rgba(24,119,242,0.13)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(circle_at_center,black,transparent_85%)]" />
        <div className="relative overflow-x-auto rounded-[28px] border border-slate-200/70 bg-white/40 px-5 py-9 backdrop-blur-sm">
          <div className="mx-auto flex w-max min-w-0 items-start justify-center gap-0">
            {/* Trigger */}
            <div className="pt-1"><Node node={c.trigger} dots="out" /></div>
            <div className="pt-[18px]"><Wire /></div>

            {/* Agent + attachments hanging beneath */}
            <div className="flex flex-col items-center">
              <div className="pt-1"><Node node={c.agent} dots="io" className="w-44" /></div>
              <svg width="2" height="22" viewBox="0 0 2 22" className="overflow-visible"><line x1="1" y1="0" x2="1" y2="22" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.5" className="animate-dash" /></svg>
              <div aria-hidden className="relative h-5 w-[360px]">
                <span className="absolute top-0 h-px bg-[#0783fd]/40" style={{ left: "12.5%", right: "12.5%" }} />
                {[12.5, 37.5, 62.5, 87.5].map(x => <span key={x} className="absolute top-0 h-5 w-px bg-[#0783fd]/40" style={{ left: `${x}%` }} />)}
              </div>
              <div className="grid w-[360px] grid-cols-4 gap-2">
                {c.attachments.map(a => (
                  <div key={a.id} className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-2 text-center">
                    <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-lg bg-[#0783fd]/10 text-[#0783fd]"><Ico name={a.icon} className="h-3 w-3" /></span>
                    <div className="mt-1 text-[10px] font-bold leading-tight text-slate-800">{a.title}</div>
                    <div className="text-[9px] leading-tight text-slate-400">{a.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-[18px]"><Wire /></div>
            {/* Router */}
            <div className="pt-1"><Node node={c.router} dots="io" /></div>

            {/* Branches */}
            <div className="flex flex-col gap-5 pt-1">
              <div className="flex items-center">
                <Wire label="lead" width={52} />
                <div className="flex flex-col gap-2">{c.branches.yes.map(n => <Node key={n.id} node={n} dots="in" />)}</div>
              </div>
              <div className="flex items-center">
                <Wire label="other" width={52} />
                <div className="flex flex-col gap-2">{c.branches.no.map(n => <Node key={n.id} node={n} dots="in" />)}</div>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">A real Talko AI automation — triggers, an AI agent, and channel actions, all no-code.</p>
      </Reveal>
    </div>
  );
}
