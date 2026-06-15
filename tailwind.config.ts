import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Talko AI blue theme (#0164ff) ──
        brand: {
          50: "#E6F0FF",
          100: "#CCE1FF",
          500: "#3B82FF",  // light accent / dots / links
          600: "#2A7BFF",  // hover (lighter than the 700 primary)
          700: "#0164FF",  // PRIMARY — buttons, active states
          800: "#0150CC",  // darker / pressed
          900: "#013E9E",
          // Legacy aliases (kept so existing class names adopt the palette):
          // `brand-dark` → deep navy for headings/dark accents.
          // `brand-green`/`greenDark` → brand blue (names retained, values blue).
          dark: "#012E78",
          green: "#0164FF",
          greenDark: "#0150CC",
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
    },
  },
  plugins: [],
} satisfies Config;
