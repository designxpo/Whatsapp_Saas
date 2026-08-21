import type { Metadata } from "next";

// middleware.ts redirects /signup on the marketing host to the APP host, so
// this page is actually served (and crawled) at app.thetalko.in/signup, not
// under metadataBase (the marketing host) — the canonical must be an
// absolute app-host URL, not a metadataBase-relative path. It's also
// reachable with a ?plan= hint (from pricing CTAs and the retired /waitlist
// redirect); without an explicit canonical, the root layout's
// self-referencing `alternates.canonical: "./"` resolves per query string,
// so Google sees /signup, /signup?plan=Scale, /signup?plan=Starter etc. as
// separate pages with no declared canonical among them ("Duplicate without
// user-selected canonical" in Search Console).
const APP_HOST = process.env.NEXT_PUBLIC_APP_HOST;
export const metadata: Metadata = {
  alternates: { canonical: APP_HOST ? `https://${APP_HOST}/signup` : "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
