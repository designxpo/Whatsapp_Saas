import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alabs Connect — WhatsApp Platform",
  description: "AnalytixLabs WhatsApp platform — broadcasts, AI replies, flows, forms, and ads",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
