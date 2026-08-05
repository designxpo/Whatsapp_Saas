// The site-wide structured-data entity graph, plus builders for the per-page
// nodes that hang off it. Pure data — no JSX — so any server component can use it.
//
// Why one shared graph instead of per-page objects: schema.org consumers merge
// nodes that share an `@id`. Defining Organization, WebSite and
// SoftwareApplication once here and referencing them by `@id` from every page
// means each page contributes facts to the SAME three entities rather than
// declaring seven unrelated look-alike organizations. That is what makes
// "publisher", "isPartOf" and "about" resolve to something instead of dangling.

import { SITE_URL } from "@/lib/siteurl";
import { TIERS, CREATOR_TIERS, type Tier } from "./site";

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const SOFTWARE_ID = `${SITE_URL}/#software`;

const LOGO_URL = `${SITE_URL}/brand/talkopng.png`;

// `sameAs` is the primary lever for the "Talko AI" brand-name collision
// (thetalko.com, gettalko.com, talka.ai) — it tells search/AI engines which
// external profiles ARE this entity. Add each profile URL here as it goes
// live (G2, Capterra, Product Hunt, LinkedIn, Crunchbase). Deliberately empty
// rather than filled with guessed URLs: a `sameAs` pointing at a profile that
// doesn't exist is worse than no `sameAs` at all.
export const ORG_SAME_AS: string[] = [];

const CHANNELS =
  "WhatsApp, Instagram, Facebook Messenger, YouTube comments, Google Business Profile reviews and website chat";

export const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORG_ID,
  name: "Talko AI",
  url: SITE_URL,
  // Raster PNG — Google's logo guidelines don't reliably consume SVG.
  logo: LOGO_URL,
  description: `Talko AI is a SaaS platform that lets businesses automate ${CHANNELS} with AI replies, broadcasts, chatbot flows and catalog checkout — all in one inbox.`,
  // `url` is required here too — schema.org's Organization validators flag a
  // nested Organization with no url of its own, even though it isn't the
  // page's primary entity. PM Technologies operates as Talko AI at this
  // domain, so the same URL is the accurate answer, not a placeholder.
  parentOrganization: { "@type": "Organization", name: "PM Technologies", url: SITE_URL },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "info@thetalko.in",
    url: `${SITE_URL}/contact`,
    availableLanguage: ["English", "Hindi"],
  },
  ...(ORG_SAME_AS.length ? { sameAs: ORG_SAME_AS } : {}),
};

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  url: SITE_URL,
  name: "Talko AI",
  description: `Talko AI — AI-powered ${CHANNELS} automation for businesses.`,
  inLanguage: "en",
  publisher: { "@id": ORG_ID },
};

// Priced tiers only — Scale is quote-based, so it has no fixed price to publish.
// Bounds are derived from the same TIERS the pricing table renders, so a price
// change can't leave a stale lowPrice/highPrice behind in structured data.
const paidOffers = [...TIERS, ...CREATOR_TIERS]
  .filter((t): t is Tier & { priceMonthly: number } => typeof t.priceMonthly === "number")
  .map(t => ({
    "@type": "Offer",
    name: `${t.name} plan`,
    price: t.priceMonthly,
    priceCurrency: "INR",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: t.priceMonthly,
      priceCurrency: "INR",
      unitText: "MONTH",
    },
    url: `${SITE_URL}/pricing`,
  }));

const offerPrices = paidOffers.map(o => o.price);

// The product itself, as a first-class entity on every page. This is the node
// that disambiguates "Talko AI" from the other companies using that name: it
// pins the brand to a concrete software category, price range and feature list.
// Declared once here and referenced by `@id` from each page's WebPage node, so
// every page contributes to one entity instead of declaring a look-alike.
export const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_ID,
  name: "Talko AI",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Customer conversation automation",
  operatingSystem: "Web",
  url: SITE_URL,
  image: LOGO_URL,
  description: `AI conversation automation for ${CHANNELS} — one inbox with AI replies, broadcasts, chatbot flows, drip sequences and catalog checkout.`,
  publisher: { "@id": ORG_ID },
  featureList: [
    "AI auto-replies grounded on your own knowledge base",
    "Unified inbox for WhatsApp, Instagram, Messenger, YouTube and web chat",
    "Template broadcasts with delivery, read and click tracking",
    "No-code chatbot flows and drip sequences",
    "Instagram and Facebook comment-to-DM automation",
    "YouTube comment automation and Google review replies",
    "In-chat catalog checkout and payment links",
  ],
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "INR",
    lowPrice: Math.min(...offerPrices),
    highPrice: Math.max(...offerPrices),
    offerCount: paidOffers.length,
    offers: paidOffers,
  },
};

export type PageSchemaOptions = {
  /** Site-relative path, e.g. "/pricing". Used for `url` and the node `@id`s. */
  path: string;
  name: string;
  description: string;
  /** ISO date (YYYY-MM-DD). Drives `dateModified` and the visible "Last updated". */
  updated: string;
  published?: string;
  /**
   * Extra, more specific page types emitted alongside "WebPage" — e.g.
   * "CollectionPage" for an index. Kept as an array WITH "WebPage" rather than
   * replacing it, so consumers that only look for the base type still match.
   */
  extraTypes?: string[];
  /** Set false on pages that don't render a <Breadcrumbs> trail. */
  breadcrumb?: boolean;
};

// A WebPage node wired into the shared graph: part of the WebSite, about the
// SoftwareApplication, published by the Organization. `dateModified` is the
// freshness signal; it comes from the same constant that renders the visible
// "Last updated" line, so the two can't drift.
export function webPageSchema(o: PageSchemaOptions) {
  const url = `${SITE_URL}${o.path}`;
  const base = idBase(o.path);
  return {
    "@context": "https://schema.org",
    "@type": o.extraTypes?.length ? ["WebPage", ...o.extraTypes] : "WebPage",
    "@id": `${base}#webpage`,
    url,
    name: o.name,
    description: o.description,
    inLanguage: "en",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": SOFTWARE_ID },
    publisher: { "@id": ORG_ID },
    datePublished: o.published ?? o.updated,
    dateModified: o.updated,
    primaryImageOfPage: LOGO_URL,
    ...(o.breadcrumb === false ? {} : { breadcrumb: { "@id": `${base}#breadcrumb` } }),
  };
}

// Fragment-id base for a page's nodes. The root path is a special case: an
// empty path would yield "https://host#webpage", which doesn't match the
// "https://host/#website" form the site-wide nodes already use. Normalising
// here keeps every root-level @id in one shape.
function idBase(path: string): string {
  return path ? `${SITE_URL}${path}` : `${SITE_URL}/`;
}

export type FaqItem = { q: string; a: string };

// FAQPage bound to the page it lives on (`mainEntityOfPage`), so the questions
// are attributed to this URL rather than floating free of any page.
export function faqPageSchema(items: FaqItem[], path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${idBase(path)}#faq`,
    mainEntityOfPage: { "@id": `${idBase(path)}#webpage` },
    mainEntity: items.map(f => ({
      "@type": "Question",
      name: f.q,
      text: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
