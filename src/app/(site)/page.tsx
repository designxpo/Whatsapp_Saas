import Link from "next/link";
import { ArrowRight, Bot, CheckCheck, MessageSquare } from "lucide-react";
import { Container, Glow, Button, SectionTitle } from "./_components/ui";
import { FeatureGrid, ThreeSteps, WhyChoose, StatsBand, IntegrationsStrip, Testimonials, CtaBand, ProblemSolution, ComparisonTable } from "./_components/sections";
import { PricingTiers } from "./_components/pricing";
import { ChatFlowDiagram, SequenceFlowDiagram } from "./_components/flows";
import { AgentCanvas } from "./_components/canvas";
import { Reveal } from "./_components/motion";
import { Faq } from "./_components/chrome";
import { HERO, SOCIAL_PROOF } from "./_content/site";

function FloatChip({ className = "", children, anim }: { className?: string; children: React.ReactNode; anim: string }) {
  return (
    <div className={`absolute z-20 hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-lg lg:flex lg:items-center lg:gap-1.5 ${anim} ${className}`}>
      {children}
    </div>
  );
}

function HeroMock() {
  return (
    <div className="relative mx-auto mt-20 max-w-2xl">
      <FloatChip anim="animate-floaty-slow" className="-left-16 top-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 312 leads today</FloatChip>
      <FloatChip anim="animate-floaty-delay" className="-right-16 top-10"><span className="h-2 w-2 rounded-full bg-[#0783fd]" /> AI replied · 0.8s</FloatChip>
      <FloatChip anim="animate-floaty" className="-right-12 -bottom-5">98% open rate</FloatChip>
      <div className="relative z-10 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_40px_120px_-50px_rgba(24,119,242,0.5)] animate-floaty">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0783fd] text-white"><MessageSquare className="h-4 w-4" /></span>
            <div className="flex-1">
              <div className="text-sm font-bold text-slate-900">Priya · WhatsApp</div>
              <div className="text-[11px] font-semibold text-emerald-500">● online · AI active</div>
            </div>
            <div className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">Sales</div>
          </div>
          <div className="space-y-3 py-4">
            <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm text-slate-700 ring-1 ring-slate-100">Hi! Do you ship to Bangalore and what's the price for the Pro plan?</div>
            <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-sm bg-[#0783fd] px-3.5 py-2 text-sm text-white">
              Yes, we ship to Bangalore in 2–3 days. The Pro plan is ₹4,999/mo and includes WhatsApp + Instagram, flows and AI replies. Want me to start your free trial? 🚀
            </div>
            <div className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-slate-400"><Bot className="h-3 w-3" /> Auto-replied by AI <CheckCheck className="h-3 w-3 text-[#0783fd]" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-3">
            {[["1,284", "Conversations"], ["98%", "Open rate"], ["312", "Leads"]].map(([v, l]) => (
              <div key={l} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100">
                <div className="text-base font-extrabold text-slate-900">{v}</div>
                <div className="text-[10px] text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Glow className="left-[-80px] top-10" />
        <Glow className="right-[-80px] top-24" />
        <Container className="relative pt-16 pb-10 text-center">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
            {HERO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-slate-500 sm:text-lg">{HERO.subtitle}</p>

          <div className="mt-6 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#0783fd]/8 px-3 py-1.5 text-xs font-semibold text-[#0783fd] ring-1 ring-[#0783fd]/15">
              <span className="flex -space-x-2">
                {["A", "R", "S"].map(c => <span key={c} className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0783fd] text-[9px] font-bold text-white ring-2 ring-white">{c}</span>)}
              </span>
              {SOCIAL_PROOF}
            </span>
          </div>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={HERO.primary.href}>{HERO.primary.label} <ArrowRight className="h-4 w-4" /></Button>
            <Button href="#how-it-works" variant="ghost">See how it works</Button>
          </div>
          <p className="mt-4 text-xs font-medium text-slate-400">{HERO.note}</p>
          <HeroMock />
        </Container>
      </section>

      {/* Signature n8n-style automation canvas — leads the product story */}
      <div id="how-it-works" className="scroll-mt-20"><AgentCanvas /></div>

      {/* Business problem → one-platform solution */}
      <ProblemSolution />

      <ThreeSteps />

      {/* Features */}
      <Container className="py-8">
        <Reveal>
          <SectionTitle eyebrow="Everything you need" title="One platform for every conversation" subtitle="Replace a stack of tools with a single, AI-native messaging platform for WhatsApp and Instagram." />
        </Reveal>
        <Reveal delay={120}><FeatureGrid /></Reveal>
      </Container>

      {/* Signature product flows */}
      <ChatFlowDiagram />
      <SequenceFlowDiagram />

      <WhyChoose />

      {/* Talko AI vs the alternatives */}
      <ComparisonTable />

      <IntegrationsStrip />
      <StatsBand />

      {/* Pricing teaser */}
      <Container className="py-12">
        <SectionTitle eyebrow="Pricing" title="Simple and transparent pricing" subtitle="Start free for 14 days. Upgrade when you're ready. Cancel anytime." />
        <PricingTiers />
        <div className="mt-8 text-center">
          <Link href="/pricing" className="text-sm font-bold text-[#0783fd] hover:underline">Compare all plans →</Link>
        </div>
      </Container>

      <Testimonials />

      <Container className="py-12">
        <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
        <Faq />
      </Container>

      <CtaBand />
    </>
  );
}
