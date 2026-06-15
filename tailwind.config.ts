import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Royal Blue theme ──
        brand: {
          50: "#EEF3FF",
          100: "#DCE6FF",
          500: "#4169E1", // royal blue
          600: "#3151CC",
          700: "#2540A8",
          800: "#1E3488",
          900: "#18296B",
          // Legacy aliases (kept so existing class names adopt the new palette):
          // `brand-dark` → deep navy for headings/dark accents.
          // `brand-green`/`greenDark` → royal blue (names retained, values blue).
          dark: "#16225C",
          green: "#3151CC",
          greenDark: "#2540A8",
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
