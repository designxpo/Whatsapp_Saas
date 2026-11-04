// The H1 and channel definition remain server-rendered for search and answer engines.
import { ArrowRight } from "lucide-react";
import { Button } from "./ui";
import { HERO } from "../_content/site";
import { WorkflowDemo } from "./workflow-demo";

export function Hero() {
  return (
    <section className="marketing-hero">
      <div className="marketing-dot-grid" aria-hidden />
      <div className="marketing-container marketing-hero-content">
        <p className="marketing-eyebrow">
          <span /> YOUR CUSTOMER ENGAGEMENT & GROWTH PLATFORM
        </p>
        <h1 id="hero-heading">
          Turn every customer interaction into{" "}
          <span className="marketing-hero-accent">growth.</span>
        </h1>
        <p className="marketing-hero-description">
          Conversations, reviews, campaigns and follow-ups.
          <br className="hidden sm:block" /> One AI workspace for the whole
          customer journey.
        </p>
        <div className="marketing-hero-actions">
          <Button href={HERO.primary.href}>
            {HERO.primary.label}
            <ArrowRight size={16} aria-hidden />
          </Button>
          <Button href="/contact" variant="ghost">
            Talk to sales
          </Button>
        </div>
        <p className="marketing-hero-note">{HERO.note}</p>
        <WorkflowDemo />
        <div
          className="marketing-channel-strip"
          aria-label="Supported channels"
        >
          <p>ONE WORKSPACE. WHEREVER THEY FIND YOU.</p>
          <div>
            {[
              ["WhatsApp", "whatsapp"],
              ["Instagram", "instagram"],
              ["Messenger", "messenger"],
              ["YouTube", "youtube"],
              ["Google Reviews", "google"],
            ].map(([label, icon]) => (
              <span key={icon}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/brand/logos/${icon}.svg`}
                  alt=""
                  width={22}
                  height={22}
                />
                {label}
              </span>
            ))}
            <span>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              Website chat
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
