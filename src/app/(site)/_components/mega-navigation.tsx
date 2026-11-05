"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { NAVIGATION_GROUPS, type NavigationCard } from "../_content/navigation";

function VisualCard({ card, compact = false }: { card: NavigationCard; compact?: boolean }) {
  return <Link href={card.href} className={`marketing-mega-card${compact ? " marketing-mega-card-compact" : ""}`}>
    <div className="marketing-mega-art"><Image src={`/marketing/navigation/${card.image}.svg`} width={640} height={360} alt="" /></div>
    <div className="marketing-mega-card-copy">
      <h3>{card.title}</h3><p>{card.description}</p>
      <span className="marketing-mega-card-action">{card.action}<span><ArrowUpRight size={16} aria-hidden="true" /></span></span>
    </div>
  </Link>;
}

export function MarketingNavigation({ brand }: { brand: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedHover = useRef<string | null>(null);
  const clearClose = useCallback(() => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const close = useCallback(() => { clearClose(); setActive(null); setMobileOpen(false); }, [clearClose]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!header.current?.contains(event.target as Node)) close(); };
    const wide = window.matchMedia("(min-width: 901px)");
    const resize = () => close();
    document.addEventListener("pointerdown", outside);
    wide.addEventListener("change", resize);
    return () => { document.removeEventListener("pointerdown", outside); wide.removeEventListener("change", resize); clearClose(); };
  }, [close, clearClose]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);

  useEffect(() => {
    if (!active && !mobileOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); suppressedHover.current = active;
      const trigger = mobileOpen ? mobileToggle.current : document.getElementById(`nav-trigger-${active}`);
      close(); trigger?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, mobileOpen, close]);

  return <header ref={header} className={`marketing-nav-shell${active || mobileOpen ? " marketing-nav-expanded" : ""}`}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
    {(active || mobileOpen) && <div className="marketing-nav-backdrop" aria-hidden="true" onPointerDown={close} />}
    <nav aria-label="Main navigation" className="marketing-nav"
      onPointerEnter={clearClose}
      onPointerLeave={event => {
        if (event.pointerType === "mouse" && window.matchMedia("(min-width: 901px)").matches) {
          clearClose(); closeTimer.current = setTimeout(() => setActive(null), 160);
        }
      }}
      onClick={event => { if ((event.target as Element).closest("a")) close(); }}>
      {brand}
      <div className="marketing-nav-links">
        {NAVIGATION_GROUPS.map(group => <div className="marketing-nav-group" key={group.id}>
          <button type="button" id={`nav-trigger-${group.id}`} className="marketing-nav-trigger"
            aria-expanded={active === group.id} aria-controls={`nav-panel-${group.id}`}
            onPointerEnter={event => { if (event.pointerType === "mouse" && suppressedHover.current !== group.id) { clearClose(); setActive(group.id); } }}
            onPointerLeave={() => { if (suppressedHover.current === group.id) suppressedHover.current = null; }}
            onClick={() => { clearClose(); suppressedHover.current = null; setActive(current => current === group.id ? null : group.id); }}
            onKeyDown={event => {
              if (event.key === "ArrowDown") {
                event.preventDefault(); setActive(group.id);
                requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>(`#nav-panel-${group.id} a`)?.focus());
              }
            }}>
            {group.label}<ChevronDown size={13} aria-hidden="true" />
          </button>
          <div id={`nav-panel-${group.id}`} className="marketing-mega-panel" hidden={active !== group.id}
            aria-labelledby={`nav-trigger-${group.id}`} onPointerEnter={clearClose}>
            <div className="marketing-mega-heading"><div><p>{group.eyebrow}</p><h2>{group.title}</h2></div><span>Explore Talko AI <ArrowRight size={16} aria-hidden="true" /></span></div>
            <div className="marketing-mega-grid">{group.cards.map(card => <VisualCard key={card.href} card={card} />)}</div>
            <div className="marketing-mega-footer"><span>A little more connected.</span><div>{group.links.map(link => <Link key={link.href} href={link.href}>{link.label}<ArrowUpRight size={12} aria-hidden="true" /></Link>)}</div></div>
          </div>
        </div>)}
        <Link href="/pricing" onPointerEnter={() => setActive(null)} onFocus={() => setActive(null)}>Pricing</Link>
      </div>
      <div className="marketing-nav-actions" onPointerEnter={() => setActive(null)} onFocus={() => setActive(null)}>
        <Link href="/login">Log in</Link><Link href="/signup" className="marketing-button marketing-button-primary">Start free trial <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
      <button ref={mobileToggle} type="button" className="marketing-mobile-toggle" aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen} aria-controls="marketing-mobile-menu" onClick={() => { setMobileOpen(value => !value); setActive(null); }}>
        {mobileOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>
      {mobileOpen && <div className="marketing-mobile-menu marketing-mobile-visual" id="marketing-mobile-menu">
        {NAVIGATION_GROUPS.map(group => <div className="marketing-mobile-group" key={group.id}>
          <button type="button" aria-expanded={active === group.id} aria-controls={`mobile-panel-${group.id}`} onClick={() => setActive(current => current === group.id ? null : group.id)}>{group.label}<ChevronDown size={16} aria-hidden="true" /></button>
          <div id={`mobile-panel-${group.id}`} hidden={active !== group.id}>
            {group.cards.map(card => <VisualCard key={card.href} card={card} compact />)}
            <div className="marketing-mobile-secondary">{group.links.map(link => <Link key={link.href} href={link.href}>{link.label}<ArrowUpRight size={12} aria-hidden="true" /></Link>)}</div>
          </div>
        </div>)}
        <div className="marketing-mobile-bottom"><Link href="/pricing">Pricing</Link><Link href="/login">Log in</Link></div>
        <Link href="/signup" className="marketing-button marketing-button-primary">Start free trial <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>}
    </nav>
  </header>;
}
