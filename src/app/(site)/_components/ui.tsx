// Server-safe presentational primitives — light "TimBot-style" theme:
// white canvas, soft pastel cards, violet accent (#0783fd), rounded & friendly.

import Link from "next/link";
import { Reveal } from "./motion";

export const PURPLE = "#0783fd";

// ── Cohesive gradient system ────────────────────────────────────────────────
// Brand blue (#0783fd) is always the anchor. It extends into indigo → violet,
// with mint and amber as supporting accents, so the whole site reads as one
// gradient family instead of flat blue. Use these everywhere a gradient is
// needed rather than ad-hoc one-offs.
export const GRADIENTS = {
  // Primary CTA / accent — brand blue flowing into indigo-violet.
  brand: "bg-gradient-to-br from-[#0783fd] via-[#3274ff] to-[#6a5cff]",
  brandHover: "hover:from-[#2a96ff] hover:via-[#4f7bff] hover:to-[#7c5cff]",
  // Big colour-block surfaces (CTA band, stat hero, hero accents).
  aurora: "bg-[linear-gradient(120deg,#0668D6_0%,#0783fd_28%,#5b6dff_62%,#8a5cff_100%)]",
  // Grounded deep block (footer) — blue into deep indigo.
  deep: "bg-[linear-gradient(135deg,#063e7e_0%,#0668D6_48%,#4f49c7_100%)]",
} as const;

// Rotating gradient icon-chip backgrounds (white icon on top). Cycle these
// across grids so dense icon rows aren't a wall of one colour. Harmonised so
// neighbouring chips never clash.
export const ICON_GRADIENTS = [
  "bg-gradient-to-br from-[#0783fd] to-[#5b6dff]",   // blue → indigo
  "bg-gradient-to-br from-[#7c5cff] to-[#a472ff]",   // violet
  "bg-gradient-to-br from-[#16b8a6] to-[#0ea5e9]",   // teal → sky
  "bg-gradient-to-br from-[#f6a84b] to-[#ef5e7e]",   // amber → rose
  "bg-gradient-to-br from-[#34c98a] to-[#0d9488]",   // mint → teal
  "bg-gradient-to-br from-[#4f8bff] to-[#8a5cff]",   // sky → violet
];

// Inline gradient text — brand blue → violet. For one highlighted word/phrase
// in an otherwise dark heading (keep most text readable slate).
export function GradientText({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`bg-gradient-to-r from-[#0783fd] via-[#4f6bff] to-[#8a5cff] bg-clip-text text-transparent ${className}`}>{children}</span>;
}

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

// Soft decorative blob (replaces the old dark sphere). Light, low-opacity.
export function Glow({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div className="h-[420px] w-[420px] max-w-[80vw] rounded-full bg-[radial-gradient(circle,rgba(7,131,253,0.18),transparent_70%)] blur-2xl" />
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#0783fd]/20 bg-[#0783fd]/5 px-3 py-1 text-xs font-semibold text-[#0783fd]">
      {children}
    </span>
  );
}

export function Button({
  href, children, variant = "primary", className = "",
}: { href: string; children: React.ReactNode; variant?: "primary" | "ghost"; className?: string }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition active:scale-[0.97]";
  const styles = variant === "primary"
    ? `${GRADIENTS.brand} ${GRADIENTS.brandHover} text-white shadow-[0_10px_28px_-10px_rgba(106,92,255,0.65)] sheen`
    : "border border-[#0783fd]/30 bg-white text-[#0783fd] hover:bg-[#0783fd]/5";
  if (href.startsWith("http")) return <a href={href} className={`${base} ${styles} ${className}`}>{children}</a>;
  return <Link href={href} className={`${base} ${styles} ${className}`}>{children}</Link>;
}

export function SectionTitle({
  eyebrow, title, subtitle, center = true, level = 2,
}: { eyebrow?: string; title: string; subtitle?: string; center?: boolean; level?: 1 | 2 }) {
  // Render as <h1> (one per page, for SEO) or the default <h2> for sections.
  const Heading = level === 1 ? "h1" : "h2";
  const headingStyles = level === 1
    ? "mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl"
    : "mt-4 text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl";
  return (
    <Reveal className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <div className={center ? "flex justify-center" : ""}><Eyebrow>{eyebrow}</Eyebrow></div>}
      <Heading className={headingStyles}>{title}</Heading>
      {subtitle && <p className="mt-3 text-balance text-slate-600">{subtitle}</p>}
    </Reveal>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-14px_rgba(7,131,253,0.28)] ${className}`}>
      {children}
    </div>
  );
}

// Pastel tones for feature / step / benefit cards. A small spread of colour
// families (not just brand blue) so sections read varied and professional.
export const TONES: Record<string, { bg: string; icon: string; ring: string }> = {
  peach: { bg: "bg-[#FDEBD2]", icon: "bg-[#F6B26B] text-white", ring: "ring-[#F6B26B]/30" },
  lavender: { bg: "bg-[#E7F0FF]", icon: "bg-[#0783fd] text-white", ring: "ring-[#0783fd]/30" },
  sky: { bg: "bg-[#D9ECF7]", icon: "bg-[#4FA6D9] text-white", ring: "ring-[#4FA6D9]/30" },
  mint: { bg: "bg-[#DDEFE4]", icon: "bg-[#4CAF82] text-white", ring: "ring-[#4CAF82]/30" },
  violet: { bg: "bg-[#EDE9FF]", icon: "bg-[#7c5cff] text-white", ring: "ring-[#7c5cff]/30" },
  rose: { bg: "bg-[#FFE6EF]", icon: "bg-[#ef4d86] text-white", ring: "ring-[#ef4d86]/30" },
};
