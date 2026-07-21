import { ImageResponse } from "next/og";

// Default social-preview card for the marketing site (WhatsApp/LinkedIn/X/Slack
// shares + AI previews). Generated at build via next/og — no static asset to
// maintain, always on-brand. Individual pages still set their own og:title /
// og:description; this supplies the image. Twitter falls back to og:image.
export const alt = "Talko AI — AI conversations for WhatsApp, Instagram & Messenger";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "90px",
          background: "linear-gradient(135deg, #0783fd 0%, #3274ff 45%, #6a5cff 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, opacity: 0.95 }}>Talko AI</div>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.02, marginTop: 28, maxWidth: 1000 }}>
          Turn every chat into a customer
        </div>
        <div style={{ fontSize: 31, marginTop: 26, opacity: 0.92, maxWidth: 1000, lineHeight: 1.3 }}>
          AI that replies, qualifies and sells across WhatsApp, Instagram, Messenger &amp; web chat — one inbox, on autopilot.
        </div>
        <div style={{ fontSize: 25, marginTop: 46, fontWeight: 700, opacity: 0.95 }}>
          thetalko.in  ·  Free 14-day trial
        </div>
      </div>
    ),
    { ...size },
  );
}
