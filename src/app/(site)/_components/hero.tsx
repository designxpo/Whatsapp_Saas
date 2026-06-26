// Home hero — a full-bleed white "orbit" hero: concentric rings, floating
// channel/integration chips, trust badges, dual CTAs and a live-activity card
// adapted to Talko's inbox. Server-safe (no client hooks).
import { ArrowRight, Star } from "lucide-react";
import { Button } from "./ui";
import { HERO, SOCIAL_PROOF } from "../_content/site";
import { TalkoDashboard } from "./hero-dashboard";

// Brand chips that float around the orbit. slug → cdn.simpleicons.org (brand
// colour). Positions are percentages within the centred stage; some hide on
// smaller screens. (All slugs verified to resolve on Simple Icons.)
// slug → cdn.simpleicons.org; src → an explicit logo URL (e.g. Iconify, for marks
// Simple Icons dropped like OpenAI). Every chip gently floats (staggered).
type Chip = { name: string; slug?: string; src?: string; pos: string; size?: string; hide?: boolean };
// A few channel marks float around the headline to frame the hero (wide screens
// only, kept clear of the dashboard below).
const CHIPS: Chip[] = [
  { name: "WhatsApp", slug: "whatsapp", pos: "left-[5%] top-[12%]", size: "h-14 w-14", hide: true },
  { name: "Instagram", slug: "instagram", pos: "left-[13%] top-[34%]", hide: true },
  { name: "Messenger", slug: "messenger", pos: "right-[5%] top-[11%]", size: "h-14 w-14", hide: true },
  { name: "Meta", slug: "meta", pos: "right-[13%] top-[33%]", hide: true },
];

// Staggered float classes so the chips don't bob in unison.
const FLOATS = ["animate-floaty", "animate-floaty-slow", "animate-floaty-delay"];

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
        {/* Soft brand glows behind the headline + dashboard */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-24 h-72 w-[36rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(7,131,253,0.14),transparent_70%)] blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[28rem] h-80 w-[48rem] max-w-[95vw] -translate-x-1/2 rounded-[40%] bg-[radial-gradient(ellipse,rgba(7,131,253,0.10),transparent_70%)] blur-3xl" />

        {/* Floating brand chips */}
        {CHIPS.map((c, i) => (
          <div key={c.name}
            className={`absolute z-10 ${c.pos} ${FLOATS[i % FLOATS.length]} ${c.hide ? "hidden lg:flex" : "hidden sm:flex"} items-center justify-center rounded-full bg-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.22)] ring-1 ring-slate-100 ${c.size ?? "h-12 w-12"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.src ?? `https://cdn.simpleicons.org/${c.slug}`} alt={c.name} title={c.name} className="h-1/2 w-1/2 object-contain" loading="lazy" />
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

          {/* Product "money shot" — the live Talko AI dashboard */}
          <div className="relative mx-auto mt-14 max-w-5xl px-1 sm:px-0">
            <TalkoDashboard />
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
            <img key={l.name} src={`https://cdn.simpleicons.org/${l.slug}/94a3b8`} alt={l.name} title={l.name} className="h-6 w-auto object-contain sm:h-7" loading="lazy" />
          ))}
        </div>
      </div>
    </section>
  );
}
