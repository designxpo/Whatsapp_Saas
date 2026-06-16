"use client";

// Interactive use-case showcase (n8n-style): a list of business problems on the
// left; clicking one renders its 2D flow on the right — a trigger → an AI brain
// (with conceptual context nodes hanging beneath) → two outcome branches. The
// graph is centred to fill the canvas, sized to fit with no horizontal scroll,
// and connectors are computed from fixed node sizes so everything lines up.
// Conceptual by design — shows what we solve, fast, not how it's built.

import { useEffect, useState } from "react";
import {
  Zap, Bot, UserPlus, Bell, MessageSquare, ShoppingBag, ShieldCheck, Clock,
  Megaphone, Check, CalendarClock, Headphones, CreditCard, BarChart3, BookOpen,
  History, Repeat, ArrowRight, type LucideIcon,
} from "lucide-react";
import { SectionTitle } from "./ui";
import { USE_CASES, type FlowNodeDef, type UseCase } from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  zap: Zap, bot: Bot, user: UserPlus, bell: Bell, message: MessageSquare,
  shopping: ShoppingBag, shield: ShieldCheck, clock: Clock, megaphone: Megaphone,
  check: Check, calendar: CalendarClock, handoff: Headphones, card: CreditCard,
  chart: BarChart3, book: BookOpen, history: History, repeat: Repeat,
};
function Ico({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Bot;
  return <I className={className} />;
}

// ── Geometry (px). Connectors are derived from these so they always meet. ─────
const NODE_W = 184, NODE_H = 64;
const WIRE = 40;
const SUB_W = 124, SUB_GAP = 12, SUB_H = 58;
const DOWN = 20, HBUS = 18;                          // brain → sub-node busses
const BRANCH_GAP = 104;                              // gap between the two outcomes
const SPLIT_W = 58;
const B1 = NODE_H / 2;                               // outcome 1 centre
const B2 = NODE_H + BRANCH_GAP + NODE_H / 2;         // outcome 2 centre
const SPINE = (B1 + B2) / 2;                         // brain output centre
const TOP = SPINE - NODE_H / 2;                      // pad to drop trigger/brain onto the spine
const SUB_ROW_W = 2 * SUB_W + SUB_GAP;

function Card({ n, accent = false, w = NODE_W, h = NODE_H, dot }: { n: FlowNodeDef; accent?: boolean; w?: number; h?: number; dot?: "in" | "out" | "io" }) {
  const showIn = dot === "in" || dot === "io";
  const showOut = dot === "out" || dot === "io";
  return (
    <div
      className={`relative flex shrink-0 items-center gap-2.5 rounded-2xl border bg-white p-3 shadow-[0_12px_30px_-16px_rgba(24,119,242,0.45)] ${accent ? "border-[#0783fd] ring-1 ring-[#0783fd]/20" : "border-slate-200"}`}
      style={{ width: w, minHeight: h }}
    >
      {showIn && <span aria-hidden className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      {showOut && <span aria-hidden className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accent ? "bg-gradient-to-br from-brand-600 to-brand-900 text-white animate-pulsesoft" : "bg-[#0783fd]/10 text-[#0783fd]"}`}>
        <Ico name={n.icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-bold leading-tight text-slate-900">{n.title}</div>
        <div className="text-[10px] leading-tight text-slate-500">{n.sub}</div>
      </div>
    </div>
  );
}

function Wire() {
  return (
    <svg width={WIRE} height="24" viewBox={`0 0 ${WIRE} 24`} className="shrink-0 overflow-visible" style={{ marginTop: SPINE - 12 }}>
      <line x1="0" y1="12" x2={WIRE - 8} y2="12" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
      <path d={`M${WIRE - 8} 7 L${WIRE} 12 L${WIRE - 8} 17 Z`} fill="#0783fd" fillOpacity="0.7" />
    </svg>
  );
}

function Flow({ uc }: { uc: UseCase }) {
  const totalH = Math.max(B2 + NODE_H / 2, TOP + NODE_H + DOWN + HBUS + SUB_H);
  return (
    <div className="flex w-max items-start" style={{ minHeight: totalH }}>
      {/* Trigger */}
      <div style={{ paddingTop: TOP }}><Card n={uc.trigger} dot="out" /></div>
      <Wire />

      {/* Brain + context sub-nodes hanging beneath */}
      <div className="flex flex-col items-center" style={{ paddingTop: TOP }}>
        <Card n={uc.brain} accent dot="io" />
        <svg width="2" height={DOWN} viewBox={`0 0 2 ${DOWN}`} className="overflow-visible"><line x1="1" y1="0" x2="1" y2={DOWN} stroke="#0783fd" strokeWidth="2" strokeOpacity="0.5" className="animate-dash" /></svg>
        <div aria-hidden className="relative" style={{ width: SUB_ROW_W, height: HBUS }}>
          <span className="absolute top-0 h-px bg-[#0783fd]/40" style={{ left: "25%", right: "25%" }} />
          {[25, 75].map(x => <span key={x} className="absolute top-0 w-px bg-[#0783fd]/40" style={{ left: `${x}%`, height: HBUS }} />)}
        </div>
        <div className="flex" style={{ gap: SUB_GAP }}>
          {uc.context.map(s => (
            <div key={s.title} className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-2.5 text-center" style={{ width: SUB_W, minHeight: SUB_H }}>
              <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-lg bg-[#0783fd]/10 text-[#0783fd]"><Ico name={s.icon} className="h-3 w-3" /></span>
              <div className="mt-1 text-[10px] font-bold leading-tight text-slate-800">{s.title}</div>
              <div className="text-[9px] leading-tight text-slate-400">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Splitter: brain output fans to the two outcomes */}
      <div className="relative shrink-0" style={{ width: SPLIT_W, height: totalH }}>
        <svg width={SPLIT_W} height={totalH} className="overflow-visible">
          <path d={`M0 ${SPINE} C 30 ${SPINE} 28 ${B1} ${SPLIT_W} ${B1}`} fill="none" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
          <path d={`M0 ${SPINE} C 30 ${SPINE} 28 ${B2} ${SPLIT_W} ${B2}`} fill="none" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
          <path d={`M${SPLIT_W - 8} ${B1 - 5} L${SPLIT_W} ${B1} L${SPLIT_W - 8} ${B1 + 5} Z`} fill="#0783fd" fillOpacity="0.7" />
          <path d={`M${SPLIT_W - 8} ${B2 - 5} L${SPLIT_W} ${B2} L${SPLIT_W - 8} ${B2 + 5} Z`} fill="#0783fd" fillOpacity="0.7" />
        </svg>
        <span className="absolute rounded-full bg-[#0783fd]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#0783fd]" style={{ left: 16, top: B1 - 22 }}>{uc.branches[0].label}</span>
        <span className="absolute rounded-full bg-[#0783fd]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#0783fd]" style={{ left: 14, top: B2 - 22 }}>{uc.branches[1].label}</span>
      </div>

      {/* Outcomes */}
      <div className="flex flex-col" style={{ gap: BRANCH_GAP }}>
        {uc.branches.map(b => <Card key={b.node.title} n={b.node} dot="in" />)}
      </div>
    </div>
  );
}

export function FlowShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const len = USE_CASES.length;

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setActive(a => (a + 1) % len), 5600);
    return () => clearTimeout(t);
  }, [active, paused, len]);

  const uc = USE_CASES[active];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
      <SectionTitle
        eyebrow="Use cases"
        title="One platform. Every business workflow."
        subtitle="Pick a problem — see how Talko AI solves it."
      />
      <div
        className="mt-12 grid items-stretch gap-6 lg:grid-cols-[300px_1fr]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {/* Left: selectable business problems */}
        <div className="flex flex-col gap-1.5">
          {USE_CASES.map((u, i) => {
            const on = i === active;
            return (
              <button
                key={u.key}
                onClick={() => setActive(i)}
                aria-pressed={on}
                className={`group relative rounded-2xl border px-4 py-3.5 text-left transition-colors ${on ? "border-[#0783fd]/30 bg-[#0783fd]/[0.06]" : "border-transparent hover:bg-slate-50"}`}
              >
                <span className={`absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-600 to-brand-900 transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
                <div className={`flex items-center justify-between gap-2 text-sm font-bold ${on ? "text-[#0783fd]" : "text-slate-900"}`}>
                  {u.tab}
                  {on && <ArrowRight className="h-4 w-4 shrink-0" />}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">{u.problem}</div>
              </button>
            );
          })}
        </div>

        {/* Right: the selected flow on a dotted canvas, centred to fill the space */}
        <div className="relative flex min-h-[440px] items-center overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/50">
          <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(24,119,242,0.12)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(circle_at_center,black,transparent_92%)]" />
          <div className="relative w-full overflow-x-auto px-6 py-8">
            <div key={active} className="animate-flowin mx-auto w-max">
              <Flow uc={uc} />
              <p className="mx-auto mt-7 max-w-2xl text-center text-sm font-medium text-slate-600">
                <span className="font-bold text-[#0783fd]">Outcome:</span> {uc.outcome}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
