import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "./_components/chrome";
import { SiteBackground } from "./_components/site-background";
import { JsonLd } from "./_components/json-ld";
import { SITE_URL } from "@/lib/siteurl";

export const metadata: Metadata = {
  // No brand suffix here — the root template ("%s — Talko AI") DOES reach this
  // layout title (it renders "… — Talko AI", single brand). It does NOT reach
  // deeper page.tsx titles, which bake the brand in themselves.
  title: "WhatsApp & Instagram Automation with AI Chatbots",
  description:
    "Automate WhatsApp, Instagram, Messenger & web chat with AI replies, broadcasts, chatbot flows and catalog checkout. One inbox for every conversation. Free 14-day trial.",
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
    "Talko AI is a SaaS platform that lets businesses automate WhatsApp, Instagram, Facebook Messenger and website chat conversations with AI replies, broadcasts, chatbot flows and catalog checkout — all in one inbox.",
  parentOrganization: { "@type": "Organization", name: "PM Technologies" },
  ...(ORG_SAME_AS.length ? { sameAs: ORG_SAME_AS } : {}),
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: SITE_URL,
  name: "Talko AI",
  publisher: { "@id": ORG_ID },
};

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
    </>
  );
}
