import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Talko AI blue theme (#0783fd) ──
        brand: {
          50: "#E9F3FF",
          100: "#CFE6FF",
          500: "#4DA3FF",  // light accent / dots / links
          600: "#2A96FF",  // hover (lighter than the 700 primary)
          700: "#0783FD",  // PRIMARY — buttons, active states
          800: "#0668D6",  // darker / pressed
          900: "#084FA3",
          // Legacy aliases (kept so existing class names adopt the palette):
          // `brand-dark` → deep navy for headings/dark accents.
          // `brand-green`/`greenDark` → brand blue (names retained, values blue).
          dark: "#073B78",
          green: "#0783FD",
          greenDark: "#0668D6",
        },
        ink: {
          400: "#A3A3A3",
          600: "#525252",
          900: "#171717",
          950: "#0A0A0A",
        },
        canvas: "#F4F5F7",
        line: "#E5E7EB",
      },
      borderRadius: {
        card: "16px",
        control: "10px",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        float: "0 8px 24px rgba(0,0,0,0.12)",
      },
      // Large type tightens as it grows (letters read too far apart otherwise);
      // body sizes are left alone. Values from Inter's own dynamic metrics,
      // -0.0223 + 0.185·e^(-0.1745·px). A tracking-* utility still wins.
      fontSize: {
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.017em" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.019em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.021em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.022em" }],
        "5xl": ["3rem", { lineHeight: "1", letterSpacing: "-0.022em" }],
      },
      // `scale` joins every transition utility, so the global press-in
      // (globals.css) eases on buttons that already declare transition-colors
      // instead of snapping.
      transitionProperty: {
        DEFAULT: "color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, scale",
        colors: "color, background-color, border-color, text-decoration-color, fill, stroke, scale",
        opacity: "opacity, scale",
        shadow: "box-shadow, scale",
        transform: "transform, scale",
      },
    },
  },
  plugins: [],
} satisfies Config;
