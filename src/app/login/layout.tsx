import type { Metadata } from "next";

// /login is served on the APP host (see middleware.ts's host split), not the
// marketing host that metadataBase/SITE_URL points at — so the canonical must
// be an absolute app-host URL, not a metadataBase-relative path. It's also
// reachable with a ?next= redirect target; without an explicit canonical, the
// root layout's self-referencing `alternates.canonical: "./"` resolves per
// query string, so Google sees /login and /login?next=/support as separate
// pages with no declared canonical between them ("Duplicate without
// user-selected canonical" in Search Console).
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST;
export const metadata: Metadata = {
  alternates: { canonical: APP_HOST ? `https://${APP_HOST}/login` : "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
