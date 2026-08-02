import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "./_components/chrome";
import { SiteBackground } from "./_components/site-background";
import { JsonLd } from "./_components/json-ld";
import { SITE_URL } from "@/lib/siteurl";

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

// Site-wide entity graph. `sameAs` is the primary lever for the "Talko AI"
// brand-name collision (thetalko.com, gettalko.com, talka.ai) — it tells
// search/AI engines which external profiles ARE this entity. Add each profile
// URL here as it goes live (G2, Capterra, Product Hunt, LinkedIn, Crunchbase).
const ORG_ID = `${SITE_URL}/#organization`;
const ORG_SAME_AS: string[] = [
  // e.g. "https://www.g2.com/products/talko-ai", "https://www.linkedin.com/company/talko-ai",
];

const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORG_ID,
  name: "Talko AI",
  url: SITE_URL,
  // Raster PNG — Google's logo guidelines don't reliably consume SVG.
  logo: `${SITE_URL}/brand/talkopng.png`,
  description:
    "Talko AI is a SaaS platform that lets businesses automate WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat with AI replies, broadcasts, chatbot flows and catalog checkout — all in one inbox.",
  // `url` is required here too — schema.org's Organization validators flag a
  // nested Organization with no url of its own, even though it isn't the
  // page's primary entity. PM Technologies operates as Talko AI at this
  // domain, so the same URL is the accurate answer, not a placeholder.
  parentOrganization: { "@type": "Organization", name: "PM Technologies", url: SITE_URL },
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "info@thetalko.in" },
  ...(ORG_SAME_AS.length ? { sameAs: ORG_SAME_AS } : {}),
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: "Talko AI",
  description: "Talko AI — AI-powered WhatsApp, Instagram, Messenger, YouTube and Google Reviews automation for businesses.",
  publisher: { "@id": ORG_ID },
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
      <JsonLd data={orgSchema} />
      <JsonLd data={websiteSchema} />
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
