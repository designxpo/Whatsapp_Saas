import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted via next/font — no render-blocking Google Fonts @import.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsapp-saas-navy.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Talko AI — AI conversations for WhatsApp & Instagram",
    template: "%s — Talko AI",
  },
  description: "Talko AI — AI conversations for WhatsApp & Instagram. Broadcasts, AI replies, chatbot flows, drip sequences, catalog and growth tools in one inbox.",
  // Brand assets live in public/brand/.
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/brand/favicon.svg",
    apple: "/brand/favicon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Talko AI",
    title: "Talko AI — AI conversations for WhatsApp & Instagram",
    description: "Automate WhatsApp & Instagram with AI replies, broadcasts, chatbot flows, drip sequences and catalog checkout — one inbox, every conversation.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Talko AI — AI conversations for WhatsApp & Instagram",
    description: "Automate WhatsApp & Instagram with AI replies, broadcasts, flows and sequences — one inbox for every conversation.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
