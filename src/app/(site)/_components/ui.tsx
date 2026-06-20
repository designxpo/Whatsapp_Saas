// Server-safe presentational primitives — light "TimBot-style" theme:
// white canvas, soft pastel cards, violet accent (#0783fd), rounded & friendly.

import Link from "next/link";

export const PURPLE = "#0783fd";

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

// Soft decorative blob (replaces the old dark sphere). Light, low-opacity.
export function Glow({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div className="h-[420px] w-[420px] max-w-[80vw] rounded-full bg-[radial-gradient(circle,rgba(24,119,242,0.18),transparent_70%)] blur-2xl" />
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
  const base = "inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-colors";
  const styles = variant === "primary"
    ? "bg-gradient-to-br from-brand-600 to-brand-900 text-white shadow-[0_8px_24px_-8px_rgba(24,119,242,0.7)] hover:from-brand-500 hover:to-brand-800"
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
    <div className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <div className={center ? "flex justify-center" : ""}><Eyebrow>{eyebrow}</Eyebrow></div>}
      <Heading className={headingStyles}>{title}</Heading>
      {subtitle && <p className="mt-3 text-balance text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(24,119,242,0.25)] ${className}`}>
      {children}
    </div>
  );
}

// Pastel tones for feature / step / benefit cards.
export const TONES: Record<string, { bg: string; icon: string; ring: string }> = {
  peach: { bg: "bg-[#FDEBD2]", icon: "bg-[#F6B26B] text-white", ring: "ring-[#F6B26B]/30" },
  lavender: { bg: "bg-[#E7F0FF]", icon: "bg-[#0783fd] text-white", ring: "ring-[#0783fd]/30" },
  sky: { bg: "bg-[#D9ECF7]", icon: "bg-[#4FA6D9] text-white", ring: "ring-[#4FA6D9]/30" },
  mint: { bg: "bg-[#DDEFE4]", icon: "bg-[#4CAF82] text-white", ring: "ring-[#4CAF82]/30" },
};
