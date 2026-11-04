"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, ChevronDown, ArrowUpRight } from "lucide-react";
import { NAV, SITE, FAQS } from "../_content/site";
import { LEGAL_NAV, LEGAL_META } from "../_content/legal";
import { BrandLogo } from "@/components/BrandLogo";
import { CookieSettingsLink } from "@/components/ConsentBanner";

function Wordmark() {
  return (
    <Link href="/" className="marketing-nav-brand" aria-label="Talko AI home">
      <BrandLogo
        height={30}
        className="max-w-[165px]"
        fallback={
          <span className="text-xl font-bold tracking-tight">{SITE.name}</span>
        }
      />
    </Link>
  );
}

const MENUS = [
  {
    label: "Platform",
    links: [
      ["Explore the platform", "/features"],
      ["Social growth workflows", "/features#social-growth"],
      ["Chrome extension", "/extension"],
    ],
  },
  {
    label: "Solutions",
    links: [
      ["Find your industry", "/industries"],
      ["For creators & coaches", "/#for-creators"],
    ],
  },
  {
    label: "Resources",
    links: [
      ["Guides", "/guides"],
      ["Blog", "/blog"],
      ["About Talko AI", "/about"],
      ["Affiliate program", "/affiliate"],
      ["Changelog", "/changelog"],
      ["Status", "/status"],
    ],
  },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="marketing-nav-shell">
      <nav
        aria-label="Main navigation"
        className="marketing-nav"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget
              .querySelectorAll("details[open]")
              .forEach((el) => {
                (el as HTMLDetailsElement).open = false;
              });
          }
        }}
      >
        <Wordmark />
        <div className="marketing-nav-links">
          {MENUS.map((menu) => (
            <details key={menu.label}>
              <summary>
                {menu.label}
                <ChevronDown size={12} aria-hidden />
              </summary>
              <div className="marketing-nav-dropdown">
                {menu.links.map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={(event) => {
                      const details = event.currentTarget.closest("details");
                      if (details) details.open = false;
                    }}
                  >
                    {label}
                    <ArrowUpRight size={13} aria-hidden />
                  </Link>
                ))}
              </div>
            </details>
          ))}
          <Link href="/pricing">Pricing</Link>
        </div>
        <div className="marketing-nav-actions">
          <Link href="/login">Log in</Link>
          <Link
            href="/signup"
            className="marketing-button marketing-button-primary"
          >
            Start free trial <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
        <button
          type="button"
          className="marketing-mobile-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="marketing-mobile-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
        {open && (
          <div className="marketing-mobile-menu" id="marketing-mobile-menu">
            {[
              ...NAV,
              { label: "For creators", href: "/#for-creators" },
              { label: "Guides", href: "/guides" },
              { label: "Blog", href: "/blog" },
              { label: "Contact", href: "/contact" },
              { label: "Log in", href: "/login" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/signup"
              className="marketing-button marketing-button-primary"
              onClick={() => setOpen(false)}
            >
              Start free trial <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1.3fr]">
        <div>
          <Wordmark />
          <h2>
            Every conversation.
            <br />A little more connected.
          </h2>
          <p>{SITE.tagline}. One inbox for every conversation.</p>
        </div>
        <FooterCol
          title="Product"
          links={[
            ["Features", "/features"],
            ["Extension", "/extension"],
            ["Industries", "/industries"],
            ["Pricing", "/pricing"],
            ["Guides", "/guides"],
            ["Blog", "/blog"],
            ["Changelog", "/changelog"],
            ["Status", "/status"],
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            ["About", "/about"],
            ["Affiliate Program", "/affiliate"],
            ["Contact", "/contact"],
            ["Sign in", "/login"],
            ["Start free trial", "/signup"],
          ]}
        />
        <div>
          <p className="footer-label">Your next chapter</p>
          <p className="mt-4">
            Start your free 14-day trial — no credit card required.
          </p>
          <form
            className="mt-4 flex flex-col gap-2"
            action="/signup"
            method="get"
          >
            <input
              type="email"
              name="email"
              aria-label="Work email"
              placeholder="Enter your work email"
              className="footer-email"
            />
            <button
              type="submit"
              className="marketing-button marketing-button-primary"
            >
              Start free trial <ArrowUpRight size={14} aria-hidden />
            </button>
          </form>
        </div>
      </div>
      <div className="marketing-container border-t border-black/10 py-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row">
          <p>
            © {new Date().getFullYear()} {LEGAL_META.legalEntity} · {SITE.name}.
            All rights reserved.
          </p>
          <nav
            aria-label="Legal"
            className="flex flex-wrap gap-x-4 gap-y-2 text-xs"
          >
            {LEGAL_NAV.map((link) => (
              <Link key={link.slug} href={`/legal/${link.slug}`}>
                {link.label}
              </Link>
            ))}
            <Link href="/legal">All policies</Link>
            <CookieSettingsLink />
          </nav>
        </div>
        <p className="mt-5">
          Product names and logos are trademarks of their respective owners.
          Their use here shows integrations and doesn&apos;t imply endorsement.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <p className="footer-label">{title}</p>
      <ul className="mt-4 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href}>{label}</Link>
          </li>
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
            <button
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
            >
              <span className="text-sm font-bold text-slate-900">{f.q}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#026cd4] transition-transform ${open === i ? "rotate-180" : ""}`}
              />
            </button>
          </h3>
          {/* Answer stays in the DOM even when collapsed (visually hidden via
              max-height, not removed) so crawlers and answer engines can read
              every answer, not just whichever one is open. */}
          <p
            className={`grid px-6 text-sm leading-relaxed text-slate-500 transition-all ${open === i ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] pb-0 opacity-0"}`}
          >
            <span className="overflow-hidden">{f.a}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
