// Composable marketing sections — light TimBot-style theme. Server-safe.

import {
  Bot, Megaphone, Workflow, Repeat, ShoppingBag, Instagram, Inbox, ShieldCheck,
  Check, Star, Search, GitCompare, BadgeCheck, X, Minus, Clock, type LucideIcon,
} from "lucide-react";
import { Container, SectionTitle, Card, Button, TONES } from "./ui";
import { Marquee } from "./marquee";
import { BrandMark } from "./logos";
import {
  FEATURES, STATS, STEPS, TESTIMONIALS, INTEGRATIONS, WHY, CTA_BULLETS, type Feature,
  PROBLEMS, COMPARE_COLS, COMPARE_ROWS,
} from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  bot: Bot, megaphone: Megaphone, workflow: Workflow, repeat: Repeat,
  shopping: ShoppingBag, instagram: Instagram, inbox: Inbox, shield: ShieldCheck,
};

function FeatureIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? Bot;
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]">
      <Icon className="h-5 w-5" />
    </span>
  );
}

export function FeatureGrid({ items = FEATURES }: { items?: Feature[] }) {
  return (
    <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(f => (
        <Card key={f.title}>
          <FeatureIcon name={f.icon} />
          <h3 className="mt-4 text-base font-bold text-slate-900">{f.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
        </Card>
      ))}
    </div>
  );
}

// "Simplified in three easy steps" — pastel cards in a soft gray container.
const STEP_ICONS = [Search, GitCompare, BadgeCheck];
const STEP_TONES = ["peach", "lavender", "sky"] as const;
export function ThreeSteps() {
  return (
    <Container className="py-16">
      <div className="rounded-[28px] bg-slate-50 px-5 py-12 sm:px-10">
        <SectionTitle title="Get started in three easy steps" subtitle="Going live can feel overwhelming — Talko AI makes it simple." />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i] ?? Search;
            const tone = TONES[STEP_TONES[i] ?? "lavender"];
            return (
              <div key={s.n} className={`rounded-2xl ${tone.bg} p-6`}>
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone.icon}`}><Icon className="h-5 w-5" /></span>
                <h3 className="mt-4 text-base font-extrabold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </Container>
  );
}

// "Why teams choose Talko AI" — split: visual + pastel benefit cards.
export function WhyChoose() {
  return (
    <Container className="py-16">
      <div className="rounded-[28px] bg-slate-50 px-5 py-12 sm:px-10">
        <SectionTitle title="Why teams choose Talko AI" subtitle="Talko AI learns your business and works the way your customers already chat." />
        <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
          <WhyVisual />
          <div>
            <h3 className="text-xl font-extrabold text-slate-900">Why <span className="text-[#0783fd]">Talko AI</span>?</h3>
            <p className="mt-2 text-sm text-slate-500">Reply faster, capture every lead, and run conversations at scale without growing your team.</p>
            <div className="mt-6 space-y-4">
              {WHY.map(b => {
                const tone = TONES[b.tone];
                return (
                  <div key={b.title} className={`rounded-2xl ${tone.bg} p-5`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}><Check className="h-4 w-4" /></span>
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">{b.title}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{b.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}

// A faux "chat over lifestyle" visual for the why-choose split.
function WhyVisual() {
  return (
    <div className="relative">
      <div className="aspect-[4/3] w-full rounded-2xl bg-gradient-to-br from-[#E7F0FF] via-white to-[#D9ECF7]" />
      <div className="absolute bottom-5 left-5 w-[72%] max-w-xs rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0783fd] text-white"><Bot className="h-3.5 w-3.5" /></span>
          <span className="text-xs font-bold text-slate-900">Chat with Talko AI</span>
        </div>
        <div className="space-y-2 pt-3">
          <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-1.5 text-xs text-slate-700">Is the Pro plan available?</div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#0783fd] px-3 py-1.5 text-xs text-white">Yes! Pro is ₹4,999/mo with WhatsApp + Instagram and AI replies. Want a free trial?</div>
        </div>
      </div>
    </div>
  );
}

export function StatsBand() {
  return (
    <Container className="py-12">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 lg:grid-cols-4">
        {STATS.map(s => (
          <div key={s.label} className="bg-white px-6 py-8 text-center">
            <div className="text-3xl font-extrabold text-[#0783fd] sm:text-4xl">{s.value}</div>
            <div className="mt-2 text-sm text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>
    </Container>
  );
}

export function IntegrationsStrip() {
  return (
    <Container className="py-16">
      <div className="rounded-[28px] bg-slate-50 px-5 py-10 text-center sm:px-10">
        <h3 className="text-xl font-extrabold text-slate-900">Works with your favorite tools</h3>
        <p className="mt-2 text-sm text-slate-500">Connect the channels and AI providers you already use.</p>
        <Marquee durationSec={28} gapClass="gap-x-16" className="mt-8 py-2">
          {INTEGRATIONS.map(i => <BrandMark key={i.name} name={i.name} slug={i.slug} />)}
        </Marquee>
      </div>
    </Container>
  );
}

export function Testimonials() {
  return (
    <Container className="py-16">
      <SectionTitle title="People love growing with Talko AI" subtitle="Here's what teams say about automating their conversations." />
      <Marquee durationSec={45} gapClass="gap-x-6" className="mt-10 py-2">
        {TESTIMONIALS.map(t => (
          <figure key={t.name} className="flex h-full w-[340px] shrink-0 flex-col rounded-[24px] bg-slate-50 p-7 sm:w-[400px]">
            <div className="flex gap-0.5 text-[#F6B26B]">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}</div>
            <blockquote className="mt-4 flex-1 text-[15px] font-medium leading-relaxed text-slate-700">“{t.quote}”</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0783fd] text-sm font-bold text-white">{t.name.charAt(0)}</span>
              <span>
                <span className="block text-sm font-bold text-slate-900">{t.name}</span>
                <span className="block text-xs text-slate-500">{t.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </Marquee>
    </Container>
  );
}

// "Solve real problems with one platform" — problem → solution rows.
const PROBLEM_ICONS: Record<string, LucideIcon> = {
  clock: Clock, inbox: Inbox, megaphone: Megaphone, shopping: ShoppingBag, workflow: Workflow, shield: ShieldCheck,
};
export function ProblemSolution() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="Why it matters" title="The problems you're losing sleep over — solved" subtitle="Every messy, manual part of customer messaging, handled by one platform instead of five." />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {PROBLEMS.map(p => {
          const Icon = PROBLEM_ICONS[p.icon] ?? Inbox;
          return (
            <div key={p.problem} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0783fd]/10 text-[#0783fd]"><Icon className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-bold text-slate-900">{p.problem}</p>
                <p className="mt-2 flex gap-2 text-sm leading-relaxed text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#2f9e6e]" />{p.solution}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Container>
  );
}

// Comparison table — Talko AI vs the alternatives. First column highlighted.
function CompareCell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#2f9e6e]/12 text-[#2f9e6e]"><Check className="h-4 w-4" /></span>;
  if (value === false) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-300"><X className="h-3.5 w-3.5" /></span>;
  return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500"><Minus className="h-3 w-3 text-slate-300" />{value}</span>;
}
export function ComparisonTable() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="Compare" title="What you get with Talko AI that you don't elsewhere" subtitle="One platform that replaces a stack of single-purpose tools — with the compliance and AI built in." />
      <div className="mx-auto mt-10 max-w-4xl overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-5 py-4 text-sm font-bold text-slate-900">Capability</th>
              {COMPARE_COLS.map((col, i) => (
                <th key={col} className={`px-5 py-4 text-center text-sm font-bold ${i === 0 ? "bg-[#0783fd]/5 text-[#0783fd]" : "text-slate-500"}`}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row, ri) => (
              <tr key={row.feature} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                <td className="px-5 py-3.5 text-sm font-medium text-slate-700">{row.feature}</td>
                {row.values.map((v, ci) => (
                  <td key={ci} className={`px-5 py-3.5 text-center ${ci === 0 ? "bg-[#0783fd]/5" : ""}`}><CompareCell value={v} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">Comparison reflects typical capabilities of generic WhatsApp tools and assembling point solutions yourself.</p>
    </Container>
  );
}

export function CtaBand() {
  return (
    <Container className="py-16">
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0783fd] to-[#0553ad] px-6 py-14 sm:px-12">
        <div className="grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h2 className="text-balance text-3xl font-extrabold leading-tight text-white sm:text-4xl">Ready to transform your customer conversations?</h2>
            <ul className="mt-6 space-y-2.5">
              {CTA_BULLETS.map(b => (
                <li key={b} className="flex items-center gap-2.5 text-sm text-white/90"><Check className="h-4 w-4 shrink-0 text-white" />{b}</li>
              ))}
            </ul>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button href="/signup" variant="ghost" className="border-white/0 bg-white text-[#0783fd] hover:bg-slate-100">Start free trial</Button>
              <a href="/pricing" className="inline-flex items-center justify-center rounded-full border border-white/40 px-5 py-3 text-sm font-bold text-white hover:bg-white/10">See pricing</a>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="ml-auto w-[85%] rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
              {[["98%", "open rate"], ["3×", "faster replies"], ["24/7", "AI on duty"]].map(([v, l]) => (
                <div key={l} className="flex items-baseline justify-between border-b border-white/10 py-2 last:border-0">
                  <span className="text-2xl font-extrabold text-white">{v}</span>
                  <span className="text-sm text-white/70">{l}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
