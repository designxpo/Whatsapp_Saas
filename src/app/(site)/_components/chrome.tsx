"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, Bot } from "lucide-react";
import { NAV, SITE, FAQS } from "../_content/site";
import { LEGAL_NAV } from "../_content/legal";
import { GRADIENTS } from "./ui";
import { BrandLogo } from "@/components/BrandLogo";

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
            <Link key={l.href} href={l.href} className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#0783fd]">{l.label}</Link>
          ))}
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <Link href={SITE.domainCta.login} className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#0783fd]">Sign in</Link>
          <Link href={SITE.domainCta.trial} className={`rounded-full ${GRADIENTS.brand} px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-10px_rgba(106,92,255,0.8)] transition-opacity hover:opacity-90`}>Sign up now</Link>
        </div>
        <button onClick={() => setOpen(v => !v)} className="md:hidden text-slate-700" aria-label="Toggle menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-100 bg-white px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map(l => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0783fd]">{l.label}</Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link href={SITE.domainCta.login} className="rounded-full border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700">Sign in</Link>
              <Link href={SITE.domainCta.trial} className={`rounded-full ${GRADIENTS.brand} px-4 py-2 text-center text-sm font-bold text-white`}>Sign up now</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={`${GRADIENTS.deep} text-white`}>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
        <div>
          <Wordmark dark />
          <p className="mt-3 max-w-xs text-sm text-white/70">{SITE.tagline}. One inbox for every conversation.</p>
        </div>
        <FooterCol title="Product" links={[["Features", "/features"], ["Industries", "/industries"], ["Pricing", "/pricing"], ["Blog", "/blog"]]} />
        <FooterCol title="Company" links={[["About", "/about"], ["Sign in", "/login"], ["Start free trial", "/signup"]]} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/70">Get started</p>
          <p className="mt-3 text-sm text-white/70">Start your free 14-day trial — no credit card required.</p>
          <form className="mt-3 flex flex-col gap-2" action="/signup" method="get">
            <input type="email" name="email" placeholder="Enter your work email" className="w-full rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none" />
            <button type="submit" className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#0783fd] transition-colors hover:bg-slate-100">Start free trial</button>
          </form>
        </div>
      </div>
      <div className="border-t border-white/15 px-5 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 text-xs text-white/70 sm:flex-row sm:px-3">
          <p>© {year} {SITE.name}. All rights reserved.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {LEGAL_NAV.map(l => (
              <Link key={l.slug} href={`/legal/${l.slug}`} className="transition-colors hover:text-white">{l.label}</Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-white/70">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label + href}><Link href={href} className="text-sm text-white/80 transition-colors hover:text-white">{label}</Link></li>
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
          <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left">
            <span className="text-sm font-bold text-slate-900">{f.q}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-[#0783fd] transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && <p className="px-6 pb-5 text-sm leading-relaxed text-slate-500">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
