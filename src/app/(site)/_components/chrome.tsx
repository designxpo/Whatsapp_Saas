"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, Bot, Phone } from "lucide-react";
import { NAV, SITE, FAQS } from "../_content/site";

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1877F2] text-white"><Bot className="h-4 w-4" /></span>
      <span className={`text-[16px] font-extrabold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>{SITE.name}</span>
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
            <Link key={l.href} href={l.href} className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#1877F2]">{l.label}</Link>
          ))}
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <Link href={SITE.domainCta.login} className="text-sm font-semibold text-slate-600 transition-colors hover:text-[#1877F2]">Sign in</Link>
          <Link href={SITE.domainCta.trial} className="rounded-full border-2 border-[#1877F2] px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-[#1877F2] transition-colors hover:bg-[#1877F2] hover:text-white">Sign up now</Link>
        </div>
        <button onClick={() => setOpen(v => !v)} className="md:hidden text-slate-700" aria-label="Toggle menu">
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-slate-100 bg-white px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map(l => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#1877F2]">{l.label}</Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Link href={SITE.domainCta.login} className="rounded-full border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700">Sign in</Link>
              <Link href={SITE.domainCta.trial} className="rounded-full bg-[#1877F2] px-4 py-2 text-center text-sm font-bold text-white">Sign up now</Link>
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
    <footer className="bg-[#1877F2] text-white">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
        <div>
          <Wordmark dark />
          <p className="mt-3 max-w-xs text-sm text-white/70">{SITE.tagline}. WhatsApp & Instagram automation with AI.</p>
          <p className="mt-5 flex items-center gap-2 text-sm font-semibold"><Phone className="h-4 w-4" /> +1-800-222-8888</p>
        </div>
        <FooterCol title="Company" links={[["About", "/about"], ["Blog", "/blog"], ["Pricing", "/pricing"]]} />
        <FooterCol title="Support" links={[["Features", "/features"], ["Sign in", "/login"], ["Contact", "/about"]]} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/70">Newsletter</p>
          <form className="mt-3 flex flex-col gap-2" action="/signup">
            <input type="email" placeholder="Enter your email" className="w-full rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none" />
            <button type="submit" className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#1877F2] transition-colors hover:bg-slate-100">Subscribe</button>
          </form>
        </div>
      </div>
      <div className="border-t border-white/15 px-5 py-6 text-center text-xs text-white/70">
        © {year} {SITE.name}. All rights reserved.
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
            <ChevronDown className={`h-4 w-4 shrink-0 text-[#1877F2] transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && <p className="px-6 pb-5 text-sm leading-relaxed text-slate-500">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}
