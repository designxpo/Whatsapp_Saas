import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Retired route — never indexable in its own right, only ever a 308 to
// /signup. Belt-and-suspenders alongside the redirect itself: Search Console
// had indexed old /waitlist?plan= links from before this became a redirect.
export const metadata: Metadata = { robots: { index: false, follow: true } };

// The waitlist has been retired now that self-serve signup is open. Keep the
// route so any shared /waitlist link (old posts, emails, the ?plan= pricing
// links) lands on signup instead of 404ing. The plan hint carries through.
export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan = "" } = await searchParams;
  redirect(plan ? `/signup?plan=${encodeURIComponent(plan)}` : "/signup");
}
