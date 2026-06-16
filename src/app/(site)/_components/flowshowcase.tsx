"use client";

// Interactive use-case showcase (n8n-style): a list of business problems on the
// left; clicking one renders its clean left-to-right flow on the right. Flows are
// LINEAR so every node connects perfectly — no clutter. Conceptual by design
// (business-outcome nodes, not a build recipe) so it shows what we solve, fast,
// without exposing the underlying implementation. Auto-advances; pauses on hover.

import { useEffect, useState } from "react";
import {
  Zap, Bot, UserPlus, Bell, MessageSquare, ShoppingBag, ShieldCheck, Clock,
  Megaphone, Check, CalendarClock, Headphones, CreditCard, BarChart3, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Container, SectionTitle } from "./ui";
import { USE_CASES, type FlowNodeDef } from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  zap: Zap, bot: Bot, user: UserPlus, bell: Bell, message: MessageSquare,
  shopping: ShoppingBag, shield: ShieldCheck, clock: Clock, megaphone: Megaphone,
  check: Check, calendar: CalendarClock, handoff: Headphones, card: CreditCard, chart: BarChart3,
};

function FlowNode({ n, first }: { n: FlowNodeDef; first?: boolean }) {
  const I = ICONS[n.icon] ?? Bot;
  return (
    <div
      className={`relative flex w-44 shrink-0 items-center gap-2.5 rounded-2xl border bg-white p-3.5 shadow-[0_12px_30px_-16px_rgba(24,119,242,0.45)] ${n.accent ? "border-[#0783fd] ring-1 ring-[#0783fd]/20" : "border-slate-200"}`}
      style={{ minHeight: 66 }}
    >
      {!first && <span aria-hidden className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${n.accent ? "bg-[#0783fd] text-white animate-pulsesoft" : "bg-[#0783fd]/10 text-[#0783fd]"}`}>
        <I className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-bold leading-tight text-slate-900">{n.title}</div>
        <div className="text-[10.5px] leading-tight text-slate-500">{n.sub}</div>
      </div>
    </div>
  );
}

// Animated dashed connector between two flow nodes.
function Wire() {
  return (
    <svg width="40" height="24" viewBox="0 0 40 24" className="shrink-0 overflow-visible">
      <line x1="0" y1="12" x2="32" y2="12" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
      <path d="M32 7 L40 12 L32 17 Z" fill="#0783fd" fillOpacity="0.7" />
    </svg>
  );
}

export function FlowShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const len = USE_CASES.length;

  // Auto-advance through use cases; pause on hover/focus and for reduced motion.
  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setActive(a => (a + 1) % len), 5200);
    return () => clearTimeout(t);
  }, [active, paused, len]);

  const uc = USE_CASES[active];

  return (
    <Container className="py-16">
      <SectionTitle
        eyebrow="Use cases"
        title="One platform. Every business workflow."
        subtitle="Pick a problem — see exactly how Talko AI solves it, end to end, with no code and no engineers."
      />
      <div
        className="mt-12 grid gap-6 lg:grid-cols-[300px_1fr]"
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
                <span className={`absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-[#0783fd] transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
                <div className={`flex items-center justify-between gap-2 text-sm font-bold ${on ? "text-[#0783fd]" : "text-slate-900"}`}>
                  {u.tab}
                  {on && <ArrowRight className="h-4 w-4 shrink-0" />}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">{u.problem}</div>
              </button>
            );
          })}
        </div>

        {/* Right: the selected flow on a dotted canvas */}
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/50">
          <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(24,119,242,0.12)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(circle_at_center,black,transparent_90%)]" />
          <div className="relative overflow-x-auto px-6 py-10">
            <div key={active} className="animate-flowin">
              <div className="flex w-max items-center">
                {uc.nodes.map((n, i) => (
                  <div key={n.title} className="flex items-center">
                    {i > 0 && <Wire />}
                    <FlowNode n={n} first={i === 0} />
                  </div>
                ))}
              </div>
              <p className="mt-7 max-w-2xl text-sm font-medium text-slate-600">
                <span className="font-bold text-[#0783fd]">Outcome:</span> {uc.outcome}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
