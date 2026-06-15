// Signature product visuals: a chatbot-flow node graph and a drip-sequence
// process timeline. Purple theme, subtle motion (floating cards, flowing dashed
// connectors, draw-in curve). Server-safe; wrapped in Reveal at usage sites.

import { MessageSquare, Bot, BookOpen, UserPlus, Headphones, Zap, Send, Clock, ShoppingCart, type LucideIcon } from "lucide-react";
import { Container, SectionTitle, TONES } from "./ui";
import { Reveal } from "./motion";
import { CHAT_FLOW, SEQUENCE_FLOW } from "../_content/site";

const FLOW_ICONS: Record<string, LucideIcon> = {
  message: MessageSquare, bot: Bot, book: BookOpen, user: UserPlus, handoff: Headphones,
  zap: Zap, send: Send, clock: Clock, cart: ShoppingCart,
};
function Ico({ name }: { name: string }) { const I = FLOW_ICONS[name] ?? Bot; return <I className="h-4 w-4" />; }

function NodeCard({ icon, title, body, accent = false, className = "" }: { icon: string; title: string; body: string; accent?: boolean; className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-[0_10px_30px_-14px_rgba(24,119,242,0.35)] ${accent ? "border-[#0164ff]/40 ring-1 ring-[#0164ff]/15" : "border-slate-200"} ${className}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent ? "bg-[#0164ff] text-white animate-pulsesoft" : "bg-[#0164ff]/10 text-[#0164ff]"}`}><Ico name={icon} /></span>
        <div>
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <div className="text-[11px] text-slate-500">{body}</div>
        </div>
      </div>
    </div>
  );
}

// ── Chatbot flow — node graph (customer → AI → 3 branches) ────────────────────
export function ChatFlowDiagram() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="Chatbot flows" title="See how your chat flow works"
        subtitle="Every incoming message is understood by AI and routed to the right outcome — answer, capture, or escalate — with no manual triage." />
      <Reveal className="relative mx-auto mt-12 max-w-3xl">
        {/* dotted backdrop */}
        <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(24,119,242,0.12)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(circle_at_center,black,transparent_75%)]" />
        <div className="relative flex flex-col items-center">
          <NodeCard icon={CHAT_FLOW.trigger.icon} title={CHAT_FLOW.trigger.title} body={CHAT_FLOW.trigger.body} className="w-full max-w-xs animate-floaty-slow" />
          <Connector />
          <NodeCard icon={CHAT_FLOW.brain.icon} title={CHAT_FLOW.brain.title} body={CHAT_FLOW.brain.body} accent className="w-full max-w-xs animate-floaty" />
          <Connector />
          {/* branch connectors — gap-0 grid keeps card centers exactly at 1/6, 1/2, 5/6 so the bus + drops line up */}
          <div aria-hidden className="relative hidden h-7 w-full max-w-2xl md:block">
            <span className="absolute top-0 h-px bg-[#0164ff]/40" style={{ left: "16.666%", right: "16.666%" }} />
            {[16.666, 50, 83.333].map(x => <span key={x} className="absolute top-0 h-7 w-px bg-[#0164ff]/40" style={{ left: `${x}%` }} />)}
          </div>
          <div className="grid w-full max-w-2xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-0">
            {CHAT_FLOW.branches.map((b, i) => {
              const tone = TONES[b.tone];
              return (
                <Reveal key={b.title} delay={i * 120} className="md:px-2">
                  <div className={`h-full rounded-2xl ${tone.bg} p-4`}>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone.icon}`}><Ico name={b.icon} /></span>
                    <div className="mt-3 text-sm font-extrabold text-slate-900">{b.title}</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{b.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </Reveal>
    </Container>
  );
}

function Connector() {
  return (
    <svg width="2" height="36" viewBox="0 0 2 36" className="my-1 overflow-visible">
      <line x1="1" y1="0" x2="1" y2="36" stroke="#0164ff" strokeWidth="2" strokeOpacity="0.5" className="animate-dash" />
    </svg>
  );
}

// ── Drip sequence — process timeline along a drawn curve ──────────────────────
export function SequenceFlowDiagram() {
  const steps = SEQUENCE_FLOW;
  return (
    <Container className="py-16">
      <div className="rounded-[28px] bg-slate-50 px-5 py-12 sm:px-10">
        <SectionTitle eyebrow="Drip sequences" title="See how your sequences work"
          subtitle="Set it once and Talko AI nurtures every lead on a timeline — triggered, timed and personalized, fully on autopilot." />
        <Reveal className="relative mt-14">
          <div className="relative grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-4 md:gap-x-8">
            {/* horizontal connector sits at the icon centers, behind the ring-masked icons — never crosses the text */}
            <span aria-hidden className="absolute top-7 hidden h-0.5 rounded bg-gradient-to-r from-[#0164ff]/20 via-[#0164ff]/50 to-[#0164ff]/20 md:block" style={{ left: "12.5%", right: "12.5%" }} />
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 140} className="relative flex flex-col items-center text-center">
                <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0164ff] text-white shadow-[0_12px_26px_-8px_rgba(24,119,242,0.8)] ring-[6px] ring-slate-50">
                  <Ico name={s.icon} />
                </span>
                <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#0164ff] ring-1 ring-[#0164ff]/15">{s.meta}</span>
                <h3 className="mt-3 text-base font-extrabold text-slate-900"><span className="text-[#0164ff]">{s.n}.</span> {s.title}</h3>
                <p className="mx-auto mt-1.5 max-w-[14rem] text-sm leading-relaxed text-slate-500">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </Reveal>
      </div>
    </Container>
  );
}
