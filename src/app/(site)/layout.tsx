import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "./_components/chrome";
import { SiteBackground } from "./_components/site-background";
import { JsonLd } from "./_components/json-ld";
import { orgSchema, websiteSchema, softwareSchema } from "./_content/schema";

export const metadata: Metadata = {
  // No brand suffix here — the root template ("%s — Talko AI") DOES reach this
  // layout title (it renders "… — Talko AI", single brand). It does NOT reach
  // deeper page.tsx titles, which bake the brand in themselves.
  // Kept ≤65 chars with the brand suffix, and shares "chat(s)" with the H1
  // ("Turn every chat into a customer") so title/H1 aren't topically disjoint.
  title: "WhatsApp, Instagram & YouTube Chat Automation with AI",
  description:
    "Turn WhatsApp, Instagram, YouTube and Google review chats into customers with AI replies, broadcasts and checkout — all in one inbox. Free 14-day trial.",
};

// Dogfooding: the marketing site runs Talko AI's own website-chat widget,
// the identical embed a customer pastes into their own site. Off by default —
// set this once a "Talko AI" webchat channel exists in the portal and its
// site key is added here, the same activation pattern used for Meta's
// Embedded Signup (coded, inert until the env var is configured).
const MARKETING_WEBCHAT_SITE_KEY = process.env.NEXT_PUBLIC_MARKETING_WEBCHAT_SITE_KEY;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* One shared entity graph on every page — Organization, WebSite and the
          SoftwareApplication itself. Each page's own WebPage node references
          these by `@id` rather than re-declaring near-duplicates. */}
      <JsonLd data={orgSchema} />
      <JsonLd data={websiteSchema} />
      <JsonLd data={softwareSchema} />
      {/* Living gradient backdrop behind the whole site (drifts on scroll). */}
      <SiteBackground />
      <div className="relative min-h-screen overflow-x-hidden text-slate-600 antialiased">
        <a href="#main-content" className="sr-only rounded-xl border border-slate-200 text-sm font-bold text-[#0783fd] focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2.5 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-[#0783fd] focus:ring-offset-2">
          Skip to main content
        </a>
        <SiteNav />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </div>
      {MARKETING_WEBCHAT_SITE_KEY && (
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script src={`/api/widget/${MARKETING_WEBCHAT_SITE_KEY}/loader.js`} async />
      )}
    </>
  );
}
