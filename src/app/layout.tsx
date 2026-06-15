import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talko AI — AI conversations for WhatsApp & Instagram",
  description: "Talko AI — AI conversations for WhatsApp & Instagram. Broadcasts, AI replies, chatbot flows, drip sequences, catalog and growth tools in one inbox.",
  // Brand assets live in public/brand/ — drop favicon.ico / icon.svg there.
  icons: {
    icon: [{ url: "/brand/favicon.ico", sizes: "any" }, { url: "/brand/icon.svg", type: "image/svg+xml" }],
    shortcut: "/brand/favicon.ico",
    apple: "/brand/apple-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
