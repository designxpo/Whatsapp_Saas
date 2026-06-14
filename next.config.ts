import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds (`NEXT_DIST_DIR=.next-build npm run build`) write to a
  // separate folder so they can't corrupt a running dev server's .next cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Allow remote images (uploaded header/banner images on Supabase storage).
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // These do native/global work that breaks when webpack bundles them into a
  // server route — load them via Node's require at runtime instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "cheerio"],
  // Ship the migration SQL files with the setup-diagnostics route so it can
  // read & offer them for copy-paste in production (not traced automatically).
  outputFileTracingIncludes: {
    "/api/admin/system/setup": ["./supabase/migrations/**"],
  },
};

export default nextConfig;
