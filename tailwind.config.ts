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
    },
  },
  plugins: [],
} satisfies Config;
