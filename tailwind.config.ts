import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Meta / Facebook blue theme ──
        brand: {
          50: "#EBF3FF",
          100: "#D6E4FF",
          500: "#1877F2", // Facebook blue
          600: "#166FE0", // hover
          700: "#0C63D4",
          800: "#0A4DA8",
          900: "#0A3D8F",
          // Legacy aliases (kept so existing class names adopt the new palette):
          // `brand-dark` → deep navy for headings/dark accents.
          // `brand-green`/`greenDark` → Facebook blue (names retained, values blue).
          dark: "#0A2A66",
          green: "#166FE0",
          greenDark: "#0C63D4",
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
