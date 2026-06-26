// Composable marketing sections — light TimBot-style theme. Server-safe.

import {
  Bot, Megaphone, Workflow, Repeat, ShoppingBag, Instagram, Inbox, ShieldCheck,
  Check, Star, Search, GitCompare, BadgeCheck, X, Minus, Clock, CheckCheck, Zap,
  Rocket, TrendingUp, MessagesSquare, Globe, type LucideIcon,
} from "lucide-react";
import { Container, SectionTitle, Card, Button, TONES, GRADIENTS, ICON_GRADIENTS } from "./ui";
import { Parallax, Reveal } from "./motion";
import { Marquee } from "./marquee";
import { BrandMark } from "./logos";
import {
  FEATURES, STATS, STEPS, TESTIMONIALS, INTEGRATIONS, INTEGRATION_CATEGORIES, CTA_BULLETS, type Feature,
  PROBLEMS, COMPARE_COLS, COMPARE_ROWS, COMPARE_NOTE,
} from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  bot: Bot, megaphone: Megaphone, workflow: Workflow, repeat: Repeat,
  shopping: ShoppingBag, instagram: Instagram, inbox: Inbox, shield: ShieldCheck,
  messenger: MessagesSquare, webchat: Globe,
};

// Gradient icon chip (white icon). `i` cycles through the harmonised palette so
// a dense grid reads as a gradient family, not a wall of blue.
function FeatureIcon({ name, i = 0 }: { name: string; i?: number }) {
  const Icon = ICONS[name] ?? Bot;
  return (
    <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_-10px_rgba(7,131,253,0.6)] ${ICON_GRADIENTS[i % ICON_GRADIENTS.length]}`}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

export function FeatureGrid({ items = FEATURES }: { items?: Feature[] }) {
  return (
    <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f, i) => (
        <Reveal key={f.title} delay={(i % 3) * 90} className="h-full">
          <Card className="h-full">
            <FeatureIcon name={f.icon} i={i} />
            <h3 className="mt-4 text-base font-bold text-slate-900">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
          </Card>
        </Reveal>
      ))}
    </div>
  );
}

// "Simplified in three easy steps" — pastel cards in a soft gray container.
const STEP_ICONS = [Search, GitCompare, BadgeCheck];
const STEP_TONES = ["peach", "violet", "mint"] as const;
export function ThreeSteps() {
  return (
    <Container className="py-16">
      <div className="relative overflow-hidden rounded-[28px] px-5 py-12 sm:px-10 ring-1 ring-slate-100 bg-[radial-gradient(120%_120%_at_100%_0%,#FFF4E8_0%,#FFFFFF_46%,#EFF4FF_100%)]">
        <Parallax speed={90} className="pointer-events-none absolute inset-0">
          <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-[#F6B26B]/18 blur-3xl" />
        </Parallax>
        <Parallax speed={-72} className="pointer-events-none absolute inset-0">
          <div className="absolute -bottom-12 left-8 h-60 w-60 rounded-full bg-[#7c5cff]/16 blur-3xl" />
        </Parallax>
        <div className="relative">
        <SectionTitle title="Get started in three easy steps" subtitle="Go live in an afternoon." />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i] ?? Search;
            const tone = TONES[STEP_TONES[i] ?? "lavender"];
            return (
              <Reveal key={s.n} delay={i * 110} className="h-full">
                <div className={`h-full rounded-2xl ${tone.bg} p-6`}>
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone.icon}`}><Icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
        </div>
      </div>
    </Container>
  );
}

// "Why teams choose Talko AI" lives in ./why-choose (client — scroll parallax).

// Tiny decorative sparkline for a KPI card.
function Spark({ pts, light = false }: { pts: number[]; light?: boolean }) {
  const W = 88, H = 30, max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((v - min) / Math.max(1, max - min)) * (H - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full">
      <polyline points={path} fill="none" stroke={light ? "#ffffff" : "#0783FD"} strokeOpacity={light ? 0.9 : 1} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const STAT_META: { icon: LucideIcon; trend: string; spark: number[] }[] = [
  { icon: CheckCheck, trend: "+12%", spark: [4, 6, 5, 8, 7, 10, 12] },
  { icon: Zap, trend: "3× faster", spark: [3, 4, 6, 5, 8, 9, 11] },
  { icon: Clock, trend: "always on", spark: [6, 6, 7, 6, 8, 7, 9] },
  { icon: Rocket, trend: "go live", spark: [2, 5, 4, 7, 9, 8, 12] },
];
// Soft tinted icon chips for the non-hero stat cards — violet / teal / amber.
const STAT_TINT = ["bg-[#7c5cff]/12 text-[#7c5cff]", "bg-[#16b8a6]/14 text-[#0d9488]", "bg-[#f6a84b]/16 text-[#e07b1f]"];

export function StatsBand() {
  return (
    <Container className="py-14">
      <div className="mb-8 flex items-center justify-center gap-2 text-center text-sm font-bold uppercase tracking-wider text-[#0783fd]">
        <TrendingUp className="h-4 w-4" /> By the numbers
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => {
          const m = STAT_META[i] ?? STAT_META[0];
          const Icon = m.icon;
          const hero = i === 0;
          return (
            <Reveal key={s.label} delay={i * 90} className="h-full">
            <div
              className={`relative h-full overflow-hidden rounded-2xl border p-5 ${hero ? `border-transparent ${GRADIENTS.aurora} text-white shadow-[0_20px_50px_-25px_rgba(106,92,255,0.7)]` : "border-slate-200 bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${hero ? "bg-white/15 text-white" : STAT_TINT[(i - 1) % STAT_TINT.length]}`}><Icon className="h-4 w-4" /></span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${hero ? "bg-white/15 text-white" : "bg-[#DDEFE4] text-[#2f9e6e]"}`}>{m.trend}</span>
              </div>
              <div className={`mt-4 text-4xl font-extrabold tracking-tight ${hero ? "text-white" : "text-slate-900"}`}>{s.value}</div>
              <div className={`mt-1 text-sm ${hero ? "text-white/80" : "text-slate-500"}`}>{s.label}</div>
              <div className="mt-3 opacity-80"><Spark pts={m.spark} light={hero} /></div>
            </div>
            </Reveal>
          );
        })}
      </div>
    </Container>
  );
}

export function IntegrationsStrip() {
  return (
    <Container className="py-16">
      <div className="relative overflow-hidden rounded-[28px] px-5 py-10 text-center sm:px-10 ring-1 ring-slate-100 bg-[radial-gradient(120%_120%_at_0%_100%,#EAFBF1_0%,#FFFFFF_50%,#F4F0FF_100%)]">
        <Parallax speed={84} className="pointer-events-none absolute inset-0">
          <div className="absolute -left-12 -bottom-10 h-56 w-56 rounded-full bg-[#34d399]/16 blur-3xl" />
        </Parallax>
        <Parallax speed={-66} className="pointer-events-none absolute inset-0">
          <div className="absolute -right-12 -top-10 h-56 w-56 rounded-full bg-[#7c5cff]/16 blur-3xl" />
        </Parallax>
        <div className="relative">
        <h3 className="text-xl font-extrabold text-slate-900">Works with your favorite tools</h3>
        <p className="mt-2 text-sm text-slate-500">Channels, AI, CRM, payments, e-commerce, scheduling and automation — all in one place.</p>
        <Marquee durationSec={30} gapClass="gap-x-12" className="mt-8 py-2">
          {INTEGRATIONS.map(i => <BrandMark key={i.name} name={i.name} slug={i.slug} iconify={i.iconify} src={i.src} />)}
        </Marquee>
        </div>
      </div>
    </Container>
  );
}

// Categorized logo wall — the full set of integrations we provide, grouped by
// what they do. Reuses BrandMark (Simple Icons CDN, grayscale → color on hover).
export function IntegrationsGrid() {
  return (
    <Container className="py-16">
      <SectionTitle eyebrow="Integrations"
        title="Connects with the tools you already use"
        subtitle="Set each up in minutes from your dashboard — no code required." />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATION_CATEGORIES.map((cat, i) => (
          <Reveal key={cat.title} delay={(i % 3) * 90} className="h-full">
          <div className="h-full rounded-[24px] border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-extrabold text-slate-900">{cat.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{cat.blurb}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-5">
              {cat.items.map(i => <BrandMark key={i.name} name={i.name} slug={i.slug} iconify={i.iconify} src={i.src} />)}
            </div>
          </div>
          </Reveal>
        ))}
      </div>
    </Container>
  );
}

export function Testimonials() {
  return (
    <Container className="py-16">
      <SectionTitle title="People love growing with Talko AI" subtitle="What teams say." />
      <Marquee durationSec={45} gapClass="gap-x-6" className="mt-10 py-2">
        {TESTIMONIALS.map(t => (
          <figure key={t.name} className="flex h-full w-[340px] shrink-0 flex-col rounded-[24px] bg-slate-50 p-7 sm:w-[400px]">
            <div className="flex gap-0.5 text-[#F6B26B]">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}</div>
            <blockquote className="mt-4 flex-1 text-[15px] font-medium leading-relaxed text-slate-700">“{t.quote}”</blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${GRADIENTS.brand}`}>{t.name.charAt(0)}</span>
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
      <SectionTitle eyebrow="Why it matters" title="The problems you're losing sleep over — solved" subtitle="The manual parts of messaging, handled by one platform." />
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {PROBLEMS.map((p, i) => {
          const Icon = PROBLEM_ICONS[p.icon] ?? Inbox;
          return (
            <Reveal key={p.problem} delay={(i % 2) * 90} className="h-full">
            <div className="flex h-full gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)]">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_8px_20px_-10px_rgba(7,131,253,0.6)] ${ICON_GRADIENTS[i % ICON_GRADIENTS.length]}`}><Icon className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-bold text-slate-900">{p.problem}</p>
                <p className="mt-2 flex gap-2 text-sm leading-relaxed text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#2f9e6e]" />{p.solution}</p>
              </div>
            </div>
            </Reveal>
          );
        })}
      </div>
    </Container>
  );
}

// Comparison table — Talko AI vs the global leaders. First column highlighted.
function CompareCell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#2f9e6e]/12 text-[#2f9e6e]"><Check className="h-4 w-4" /></span>;
  if (value === false) return <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-300"><X className="h-3.5 w-3.5" /></span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Minus className="h-3 w-3 shrink-0 text-slate-300" />{value}</span>;
}
export function ComparisonTable() {
  // Derive the "all-in-one score" per column = how many capabilities are fully
  // included (✓). Keeps the summary honest if rows are added or removed.
  const scores = COMPARE_COLS.map((_, ci) => COMPARE_ROWS.filter(r => r.values[ci] === true).length);
  const total = COMPARE_ROWS.length;
  return (
    <section className="py-16">
      <Container>
        <SectionTitle eyebrow="Talko AI vs the world"
          title="More channels, more AI, more value — in one platform"
          subtitle="The global leaders are each great in one lane. Talko AI does all of it together, on your own AI key." />
      </Container>
      {/* Wider than the page container so all 7 competitors fit without scrolling
          on desktop; table-fixed keeps columns even; scrolls only on small screens. */}
      <Reveal className="mx-auto mt-10 w-full max-w-7xl px-4 sm:px-8">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table aria-label="Talko AI capability comparison with global alternatives" className="w-full min-w-[860px] table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="w-[24%] px-4 py-3.5 text-[13px] font-bold text-slate-900">Capability</th>
                {COMPARE_COLS.map((col, i) => (
                  <th key={col} className={`px-2 py-3.5 text-center text-[12px] font-bold leading-tight ${i === 0 ? `rounded-t-xl ${GRADIENTS.brand} text-white` : "text-slate-500"}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row, ri) => (
                <tr key={row.feature} className={ri % 2 ? "bg-slate-50/60" : "bg-white"}>
                  <td className="px-4 py-3 text-[12.5px] font-medium leading-snug text-slate-700">{row.feature}</td>
                  {row.values.map((v, ci) => (
                    <td key={ci} className={`px-2 py-3 text-center ${ci === 0 ? "bg-[#0783fd]/5" : ""}`}><CompareCell value={v} /></td>
                  ))}
                </tr>
              ))}
              {/* All-in-one score — visualizes "more features than anyone else". */}
              <tr className="border-t-2 border-slate-200 bg-white">
                <td className="px-4 py-3.5 text-[12.5px] font-extrabold text-slate-900">Capabilities included</td>
                {scores.map((s, ci) => (
                  <td key={ci} className={`px-2 py-3.5 text-center ${ci === 0 ? "bg-[#0783fd]/5" : ""}`}>
                    <span className={`text-sm font-extrabold ${ci === 0 ? "text-[#0783fd]" : "text-slate-400"}`}>{s}</span>
                    <span className="text-[11px] font-semibold text-slate-400">/{total}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-slate-500">{COMPARE_NOTE}</p>
      </Reveal>
    </section>
  );
}

export function CtaBand() {
  return (
    <Container className="py-16">
      <div className={`relative overflow-hidden rounded-[28px] ${GRADIENTS.aurora} px-6 py-14 sm:px-12`}>
        {/* Soft colour-mesh overlay so the block reads rich, not a flat slab. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(60%_80%_at_15%_10%,rgba(52,211,153,0.28),transparent_60%),radial-gradient(50%_70%_at_95%_90%,rgba(255,180,107,0.22),transparent_60%)]" />
        {/* Drifting light blooms — parallax depth on the CTA block. */}
        <Parallax speed={70} className="pointer-events-none absolute inset-0">
          <div className="absolute -left-10 top-0 h-60 w-60 rounded-full bg-white/15 blur-3xl" />
        </Parallax>
        <Parallax speed={-56} className="pointer-events-none absolute inset-0">
          <div className="absolute -bottom-16 right-10 h-64 w-64 rounded-full bg-[#34d399]/25 blur-3xl" />
        </Parallax>
        <Reveal className="relative grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
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
        </Reveal>
      </div>
    </Container>
  );
}
