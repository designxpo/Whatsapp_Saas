// Shared marketing primitives: Talko blue-to-cyan, light canvas and conversation corners.
import Link from "next/link";
import { Reveal } from "./motion";

export const PURPLE = "#0783fd";

// All marketing surfaces use the blue-to-cyan palette of the Talko logo.
export const GRADIENTS = {
  brand: "site-brand-fill",
  brandHover: "site-brand-hover",
  aurora: "site-brand-surface",
  deep: "site-dark-surface",
} as const;
export const ICON_GRADIENTS = Array(6).fill("site-icon-chip") as string[];

export function GradientText({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`site-gradient-text ${className}`}>{children}</span>;
}

export function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`marketing-container site-container ${className}`}>
      {children}
    </div>
  );
}

// Soft decorative blob (replaces the old dark sphere). Light, low-opacity.
export function Glow({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`site-glow pointer-events-none absolute ${className}`}
    >
      <div className="h-[420px] w-[420px] max-w-[80vw] rounded-full bg-[radial-gradient(circle,rgba(7,131,253,0.18),transparent_70%)] blur-2xl" />
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="site-eyebrow inline-flex items-center gap-2 rounded-full border border-[#0783fd]/20 bg-[#0783fd]/5 px-3 py-1 text-xs font-semibold text-[#026cd4]">
      {children}
    </span>
  );
}

export function Button({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const base = "marketing-button";
  const styles =
    variant === "primary"
      ? "marketing-button-primary"
      : "marketing-button-ghost";
  if (href.startsWith("http"))
    return (
      <a href={href} className={`${base} ${styles} ${className}`}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  subtitle,
  center = true,
  level = 2,
  id,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  center?: boolean;
  level?: 1 | 2;
  id?: string;
}) {
  // Render as <h1> (one per page, for SEO) or the default <h2> for sections.
  const Heading = level === 1 ? "h1" : "h2";
  const headingStyles =
    level === 1
      ? "mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl"
      : "mt-4 text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl";
  return (
    <Reveal className={`max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow && (
        <div className={center ? "flex justify-center" : ""}>
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
      )}
      {/* scroll-mt so a jump to #id doesn't tuck the heading under the sticky nav */}
      <Heading
        id={id}
        className={`site-section-title scroll-mt-24 ${headingStyles}`}
      >
        {title}
      </Heading>
      {subtitle && (
        <p className="site-section-subtitle mt-3 text-balance text-slate-600">
          {subtitle}
        </p>
      )}
    </Reveal>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`site-card rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_16px_36px_-14px_rgba(7,131,253,0.28)] ${className}`}
    >
      {children}
    </div>
  );
}

// Keep semantic tone names for callers; the visual treatment is shared.
const BRAND_TONE = {
  bg: "site-soft-panel",
  icon: "site-icon-chip",
  ring: "ring-[#0783fd]/15",
};
export const TONES: Record<string, { bg: string; icon: string; ring: string }> =
  Object.fromEntries(
    ["peach", "lavender", "sky", "mint", "violet", "rose"].map((name) => [
      name,
      BRAND_TONE,
    ]),
  );
