"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, Bot } from "lucide-react";
import { NAV, SITE, FAQS } from "../_content/site";
import { LEGAL_NAV, LEGAL_META } from "../_content/legal";
import { GRADIENTS } from "./ui";
import { BrandLogo } from "@/components/BrandLogo";
import { CookieSettingsLink } from "@/components/ConsentBanner";

function Wordmark({ dark = false }: { dark?: boolean }) {
  // Dark footer: the brand logo has dark text, so sit it on a white chip to stay
  // legible on the blue footer. Light nav: show the full logo lockup directly.
  if (dark) {
    return (
      <Link href="/" className="inline-flex items-center rounded-xl bg-white px-3 py-2 shadow-sm">
        <BrandLogo height={34} className="max-w-[190px]" fallback={
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0783fd] text-white"><Bot className="h-4 w-4" /></span>
            <span className="text-[15px] font-extrabold tracking-tight text-slate-900">{SITE.name}</span>
          </span>
        } />
      </Link>
    );
  }
  return (
    <Link href="/" className="flex items-center">
      <BrandLogo height={32} className="max-w-[200px]" fallback={
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0783fd] text-white"><Bot className="h-4 w-4" /></span>
          <span className="text-[16px] font-extrabold tracking-tight text-slate-900">{SITE.name}</span>
        </span>
      } />
    </Link>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <div className="hidden items-center gap-8 md:flex">
          {NAV.map(l => (
            <Link key={l.href} href={l.href} className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#026cd4]">{l.label}</Link>
          ))}
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#026cd4]">Log in</Link>
          <Link href="/signup" className={`rounded-full ${GRADIENTS.brand} px-4 py-1.5 text-sm font-bold text-white shadow-[0_8px_24px_-10px_rgba(106,92,255,0.8)] transition-opacity hover:opacity-90`}>Start free trial</Link>
        </div>
        <button onClick={() => setOpen(v => !v)} className="md:hidden text-slate-700" aria-label="Toggle menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-100 bg-white px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map(l => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#026cd4]">{l.label}</Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-full border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700 hover:bg-slate-50">Log in</Link>
              <Link href="/signup" onClick={() => setOpen(false)} className={`rounded-full ${GRADIENTS.brand} px-4 py-2 text-center text-sm font-bold text-white`}>Start free trial</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// Footer text is white/90, not /70: the gradient's lightest stop (#0668D6)
// left white/70 at 3.4:1 — below the 4.5:1 small text needs. White/90 is 4.6:1
// there and higher everywhere else on the gradient.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={`${GRADIENTS.deep} text-white`}>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
        <div>
          <Wordmark dark />
          <p className="mt-3 max-w-xs text-sm text-white/90">{SITE.tagline}. One inbox for every conversation.</p>
        </div>
        <FooterCol title="Product" links={[["Features", "/features"], ["Extension", "/extension"], ["Industries", "/industries"], ["Pricing", "/pricing"], ["Guides", "/guides"], ["Blog", "/blog"], ["Changelog", "/changelog"], ["Status", "/status"]]} />
        <FooterCol title="Company" links={[["About", "/about"], ["Affiliate Program", "/affiliate"], ["Contact", "/contact"], ["Sign in", "/login"], ["Start free trial", "/signup"]]} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/90">Get started</p>
          <p className="mt-3 text-sm text-white/90">Start your free 14-day trial — no credit card required.</p>
          <form className="mt-3 flex flex-col gap-2" action="/signup" method="get">
            {/* Darkened field + white/80 placeholder: white/50 on the old white/10
                field was ~2.2:1. This pair stays above 5.3:1 across the gradient. */}
            <input type="email" name="email" aria-label="Work email" placeholder="Enter your work email" className="w-full rounded-full border border-white/30 bg-black/20 px-4 py-2.5 text-sm text-white placeholder:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70" />
            <button type="submit" className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#026cd4] transition-colors hover:bg-slate-100">Start free trial</button>
          </form>
        </div>
      </div>
      <div className="border-t border-white/15 px-5 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 text-xs text-white/90 sm:flex-row sm:px-3">
          {/* The legal entity, not just the product name — Talko AI is a
              product of the company named in the policies (_content/legal.ts). */}
          <p>© {year} {LEGAL_META.legalEntity} · {SITE.name}. All rights reserved.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {LEGAL_NAV.map(l => (
              <Link key={l.slug} href={`/legal/${l.slug}`} className="transition-colors hover:text-white">{l.label}</Link>
            ))}
            {/* /legal is in the sitemap but was the one page nothing linked to —
                the footer jumped straight to each policy and skipped the index,
                leaving a submitted URL with no internal path to it. */}
            <Link href="/legal" className="transition-colors hover:text-white">All policies</Link>
            {/* Re-opens the cookie consent choice, so it can be changed later. */}
            <CookieSettingsLink className="transition-colors hover:text-white" />
          </nav>
        </div>
        <p className="mx-auto mt-4 w-full max-w-6xl text-center text-[11px] leading-relaxed text-white/90 sm:px-3 sm:text-left">
          Product names and logos are trademarks of their respective owners. Their use here shows integrations and doesn&apos;t imply endorsement.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-white/90">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label + href}><Link href={href} className="text-sm text-white/90 transition-colors hover:text-white">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto mt-10 max-w-3xl divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {FAQS.map((f, i) => (
        <div key={f.q}>
          {/* Heading wraps the trigger (the standard accessible accordion
              pattern) so each question is a real, crawlable h3 — not just a
              styled span. */}
          <h3>
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left">
              <span className="text-sm font-bold text-slate-900">{f.q}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-[#026cd4] transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
          </h3>
          {/* Answer stays in the DOM even when collapsed (visually hidden via
              max-height, not removed) so crawlers and answer engines can read
              every answer, not just whichever one is open. */}
          <p className={`grid px-6 text-sm leading-relaxed text-slate-500 transition-all ${open === i ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] pb-0 opacity-0"}`}>
            <span className="overflow-hidden">{f.a}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
