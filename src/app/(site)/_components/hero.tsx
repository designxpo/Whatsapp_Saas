// Home hero — a full-bleed white "orbit" hero: concentric rings, floating
// channel/integration chips, trust badges, dual CTAs and a live-activity card
// adapted to Talko's inbox. Server-safe (no client hooks).
import { ArrowRight, Star, Check } from "lucide-react";
import { Button } from "./ui";
import { HERO, SOCIAL_PROOF } from "../_content/site";

// Brand chips that float around the orbit. slug → cdn.simpleicons.org (brand
// colour). Positions are percentages within the centred stage; some hide on
// smaller screens. (All slugs verified to resolve on Simple Icons.)
type Chip = { name: string; slug: string; pos: string; size?: string; hide?: boolean };
const CHIPS: Chip[] = [
  { name: "WhatsApp", slug: "whatsapp", pos: "left-[2%] top-[30%]", size: "h-14 w-14" },
  { name: "Instagram", slug: "instagram", pos: "left-[11%] top-[58%]" },
  { name: "Gemini", slug: "googlegemini", pos: "left-[22%] top-[16%]", hide: true },
  { name: "Razorpay", slug: "razorpay", pos: "left-[5%] top-[76%]", hide: true },
  { name: "Shopify", slug: "shopify", pos: "left-[26%] top-[84%]", size: "h-11 w-11", hide: true },
  { name: "Messenger", slug: "messenger", pos: "right-[2%] top-[28%]", size: "h-14 w-14" },
  { name: "Meta", slug: "meta", pos: "right-[11%] top-[56%]" },
  { name: "Anthropic", slug: "anthropic", pos: "right-[22%] top-[15%]", hide: true },
  { name: "Stripe", slug: "stripe", pos: "right-[5%] top-[74%]", hide: true },
  { name: "HubSpot", slug: "hubspot", pos: "right-[26%] top-[84%]", size: "h-11 w-11", hide: true },
];

// Concentric ring diameters (px) — drawn as centred circles behind the headline.
const RINGS = [280, 460, 660, 880];

// The little "live in your inbox" activity feed that floats over the hero.
const ACTIVITY = [
  { initials: "PS", tone: "from-[#25D366] to-[#128C7E]", name: "Priya Sharma", action: "messaged on WhatsApp", meta: "AI replied in 2s · lead captured", dot: "#25D366" },
  { initials: "RM", tone: "from-[#E1306C] to-[#C13584]", name: "Rahul Mehta", action: "DM'd on Instagram", meta: "Booked a demo for Fri 3pm", dot: "#E1306C" },
  { initials: "AW", tone: "from-brand-500 to-brand-800", name: "Website visitor", action: "started a web chat", meta: "Answered from your knowledge base", dot: "#0783fd" },
];

function RatingBadge({ label, score }: { label: string; score: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <span className="flex items-center gap-0.5 text-[#F6B26B]">
        {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-3 w-3 fill-current" />)}
      </span>
      <b className="text-slate-900">{score}</b> {label}
    </span>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white pb-4">
      {/* Centred stage — rings, chips and content cluster here so they stay
          balanced while the white background fills the full width (no side gap). */}
      <div className="relative mx-auto max-w-6xl px-5">
        {/* Concentric orbit rings, centred on the hero */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <div className="relative mt-[170px]">
            {RINGS.map(d => (
              <span key={d} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200/70"
                style={{ width: d, height: d }} />
            ))}
          </div>
        </div>
        {/* Soft brand glow behind the headline */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-28 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(7,131,253,0.12),transparent_70%)] blur-2xl" />

        {/* Floating brand chips */}
        {CHIPS.map(c => (
          <div key={c.name}
            className={`absolute z-10 ${c.pos} ${c.hide ? "hidden lg:flex" : "hidden sm:flex"} items-center justify-center rounded-full bg-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.22)] ring-1 ring-slate-100 ${c.size ?? "h-12 w-12"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://cdn.simpleicons.org/${c.slug}`} alt={`${c.name} logo`} title={c.name} className="h-1/2 w-1/2 object-contain" loading="lazy" />
          </div>
        ))}

        {/* Centred hero content */}
        <div className="relative z-20 pt-14 pb-12 text-center sm:pt-20">
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <RatingBadge label="Google reviews" score="4.9" />
            <span className="hidden h-3 w-px bg-slate-200 sm:block" />
            <RatingBadge label="Trustpilot" score="4.8" />
          </div>

          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl">
            {HERO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-slate-500 sm:text-lg">{HERO.subtitle}</p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={HERO.primary.href}>{HERO.primary.label} <ArrowRight className="h-4 w-4" /></Button>
            <Button href="/signup" variant="ghost">Talk to sales team</Button>
          </div>
          <p className="mt-4 text-xs font-medium text-slate-400">{HERO.note}</p>

          {/* Live-activity card — what the inbox does, in motion */}
          <div className="relative mx-auto mt-12 max-w-md">
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-2.5 shadow-[0_24px_60px_-24px_rgba(7,131,253,0.45)] backdrop-blur">
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Live in your inbox</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#2f9e6e]">
                  <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2f9e6e] opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#2f9e6e]" /></span>
                  Auto-replied by AI
                </span>
              </div>
              <div className="space-y-1.5">
                {ACTIVITY.map(a => (
                  <div key={a.name} className="flex items-center gap-3 rounded-xl bg-slate-50/80 px-3 py-2 text-left">
                    <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${a.tone} text-[11px] font-bold text-white`}>
                      {a.initials}
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white" style={{ background: a.dot }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-slate-900"><span className="font-bold">{a.name}</span> <span className="text-slate-500">{a.action}</span></p>
                      <p className="flex items-center gap-1 truncate text-[11px] text-slate-400"><Check className="h-3 w-3 text-[#0783fd]" /> {a.meta}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trust line + grayscale logo wall — full width */}
      <div className="mx-auto max-w-5xl px-5 pt-6">
        <p className="text-center text-xs font-semibold text-slate-400">{SOCIAL_PROOF}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-9 gap-y-5 opacity-70">
          {[
            { name: "Shopify", slug: "shopify" }, { name: "Stripe", slug: "stripe" },
            { name: "Razorpay", slug: "razorpay" }, { name: "HubSpot", slug: "hubspot" },
            { name: "Zapier", slug: "zapier" }, { name: "Meta", slug: "meta" },
            { name: "WooCommerce", slug: "woocommerce" },
          ].map(l => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={l.name} src={`https://cdn.simpleicons.org/${l.slug}/94a3b8`} alt={`${l.name} logo`} title={l.name} className="h-6 w-auto object-contain sm:h-7" loading="lazy" />
          ))}
        </div>
      </div>
    </section>
  );
}
