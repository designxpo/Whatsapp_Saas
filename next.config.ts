import type { NextConfig } from "next";

// Allowed remote-image hosts for the Next image optimizer: the project's
// Supabase storage host (derived from the env URL) plus Meta CDNs (IG profile
// pics). Replaces a wildcard "**" that made /_next/image an open proxy.
const supabaseHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname || undefined; }
  catch { return undefined; }
})();
const IMAGE_HOSTS = [
  ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost }] : []),
  { protocol: "https" as const, hostname: "**.cdninstagram.com" },
  { protocol: "https" as const, hostname: "**.fbcdn.net" },
];

// Baseline security headers applied to every response. Kept conservative so we
// don't break Next's inline runtime: clickjacking (frame-ancestors), MIME
// sniffing, transport pinning, and referrer leakage are covered without a
// restrictive script-src CSP.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,    // don't advertise the framework/version
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Verification builds (`NEXT_DIST_DIR=.next-build npm run build`) write to a
  // separate folder so they can't corrupt a running dev server's .next cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Scope the Next image optimizer to known hosts instead of "**" (open proxy).
  // The app renders images via plain <img>, so this never affects rendering.
  images: { remotePatterns: IMAGE_HOSTS },
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
