import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talko AI — AI conversations for WhatsApp & Instagram",
  description: "Talko AI — AI conversations for WhatsApp & Instagram. Broadcasts, AI replies, chatbot flows, drip sequences, catalog and growth tools in one inbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
