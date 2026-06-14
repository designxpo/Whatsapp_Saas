import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Emerald Fintech theme ──
        brand: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          900: "#14532D",
          // Legacy aliases (kept so existing class names adopt the new palette):
          // `brand-dark` was the old blue #003368 → now near-black ink (headings,
          // borders, dark accents). `brand-green`/`greenDark` → emerald.
          dark: "#171717",
          green: "#16A34A",
          greenDark: "#15803D",
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
