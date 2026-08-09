import { redirect } from "next/navigation";

// The waitlist has been retired now that self-serve signup is open. Keep the
// route so any shared /waitlist link (old posts, emails, the ?plan= pricing
// links) lands on signup instead of 404ing. The plan hint carries through.
export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan = "" } = await searchParams;
  redirect(plan ? `/signup?plan=${encodeURIComponent(plan)}` : "/signup");
}
