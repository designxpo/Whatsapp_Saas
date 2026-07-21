import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SITE_URL } from "@/lib/siteurl";
import "./globals.css";

// Self-hosted via next/font — no render-blocking Google Fonts @import.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // `default` is used when a page/route sets no title of its own; child
    // routes that DO set a title get it wrapped by `template`. Child titles
    // must therefore NOT repeat the brand (the template appends it).
    default: "Talko AI — AI conversations for WhatsApp, Instagram & Messenger",
    template: "%s — Talko AI",
  },
  description: "Automate WhatsApp, Instagram, Messenger & web chat with AI replies, broadcasts and chatbot flows. One inbox for every conversation. Free 14-day trial.",
  // Self-referencing canonical: `./` resolves per-page against metadataBase +
  // the current path, so every route gets its own correct canonical URL.
  alternates: { canonical: "./" },
  // Google Search Console meta-tag verification — set the token from GSC as
  // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION (or use the HTML file in public/).
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
  // Small raster favicons (was a 2.72MB SVG fetched on every route as all three).
  icons: {
    icon: [{ url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" }],
    shortcut: "/brand/favicon-32.png",
    apple: { url: "/brand/favicon-180.png", sizes: "180x180" },
  },
  openGraph: {
    type: "website",
    siteName: "Talko AI",
    title: "Talko AI — AI conversations for WhatsApp, Instagram & Messenger",
    description: "Automate WhatsApp, Instagram, Messenger & web chat with AI replies, broadcasts, chatbot flows and catalog checkout — one inbox, every conversation.",
    // No static `url` here — it would force every page's og:url to the homepage.
    // Per-page canonical (alternates.canonical "./") carries the correct URL.
  },
  twitter: {
    card: "summary_large_image",
    title: "Talko AI — AI conversations for WhatsApp, Instagram & Messenger",
    description: "Automate WhatsApp, Instagram, Messenger & web chat with AI replies, broadcasts, flows and sequences — one inbox for every conversation.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Warm up the icon CDNs used above the fold (brand marks / hero chips)
            so their TLS/connection setup isn't on the critical path. */}
        <link rel="preconnect" href="https://cdn.simpleicons.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.iconify.design" crossOrigin="anonymous" />
        {/* No-JS safety net: scroll-reveal bakes a hidden state into SSR markup
            (opacity:0). If JS never runs, force every [data-reveal] element
            visible so no content is lost. (Reduced-motion has its own rule.) */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
