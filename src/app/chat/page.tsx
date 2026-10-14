import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { resolveBridgeTarget } from "@/lib/handlehub";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// A thin ad destination: useful to a real visitor, and nothing we want
// competing in organic search.
export const metadata: Metadata = {
  title: "Chat on WhatsApp",
  description: "Start a WhatsApp conversation — the assistant replies instantly and the team picks up from there.",
  robots: { index: false, follow: false },
};

// GET /chat?src=<ref code> — the bridge between an ad and WhatsApp.
//
// ── Why this is a PAGE and not a redirect ──────────────────────────────────
//
// Its sibling /r/[code] 302s straight to its target, and that is exactly what
// this must not do. Google Ads requires the destination to stay on a domain
// the advertiser owns, and reads an automatic bounce to wa.me as a
// destination mismatch — which gets the ad disapproved. The visitor has to
// tap through themselves.
//
// That tap is also what carries the invisible ref code into WhatsApp, so ad
// traffic arrives attributed instead of anonymous.
//
// ── Why this is the only place the UTMs exist ──────────────────────────────
//
// The visitor's next hop is WhatsApp, which carries nothing but the prefilled
// text. Every parameter not read on this page is gone for good — so they are
// read here, written to a session row, and the row's short code travels in
// the greeting.
//
// ── Tenant ─────────────────────────────────────────────────────────────────
//
// A public visitor has no session, so the ref code is what says which
// business this belongs to. resolveBridgeTarget looks it up unscoped and
// returns the owning tenant, the same shape registerClick already uses.

type Param = string | string[] | undefined;

type ChatParams = {
  src?: Param; sclx?: Param;
  gclid?: Param; fbclid?: Param;
  utm_source?: Param; utm_medium?: Param; utm_campaign?: Param;
  utm_term?: Param; utm_content?: Param;
};

export default async function ChatBridgePage({ searchParams }: { searchParams: Promise<ChatParams> }) {
  // Next hands back string[] when a parameter is repeated (?src=a&src=b).
  // Anyone can append one, so treating it as a string would throw and render
  // this paid destination as an error page. Take the first value.
  const sp = await searchParams;
  const one = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";
  // Bounded here rather than in the column: these arrive on a public URL, so
  // an over-long value must cost a truncated string and nothing more. A
  // visitor must never lose their way to WhatsApp over a tracking value.
  const cap = (v: Param, n = 256) => one(v).slice(0, n) || null;

  const target = await resolveBridgeTarget(one(sp.src), {
    sclxId: one(sp.sclx).slice(0, 64) || null,
    pagePath: "/chat",
    utm: {
      source: cap(sp.utm_source), medium: cap(sp.utm_medium),
      campaign: cap(sp.utm_campaign), term: cap(sp.utm_term),
      content: cap(sp.utm_content),
      gclid: cap(sp.gclid, 200), fbclid: cap(sp.fbclid, 200),
    },
  }).catch(() => null);

  // The business's own name, so a tenant's ad does not land on a page
  // branded with somebody else's. Best-effort: a missing name costs a
  // heading, never the button.
  let brand = "";
  if (target) {
    const { data } = await db().from("tenants").select("name").eq("id", target.tenantId).maybeSingle();
    brand = ((data as { name?: string } | null)?.name ?? "").trim();
    if (brand.toLowerCase() === "default") brand = "";
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 bg-canvas">
      <div className="w-full max-w-sm space-y-4">
        <div className="bg-white rounded-card border border-line p-7 space-y-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              {brand && <p className="text-[11px] font-bold uppercase tracking-wide text-ink-600">{brand}</p>}
              <h1 className="text-xl font-bold text-ink-900 mt-0.5">Chat with us on WhatsApp</h1>
              {/* Honest about the AI: the first reply is the assistant's. */}
              <p className="text-sm text-ink-600 mt-1">
                Our assistant replies instantly, and the team picks up from there.
              </p>
            </div>
          </div>

          {target ? (
            <a
              href={target.link}
              className="w-full py-3 rounded-control bg-brand-700 hover:bg-brand-900 text-white font-semibold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              <MessageSquare className="w-4 h-4" /> Start the chat
            </a>
          ) : (
            // No usable entry point — say so plainly rather than render a
            // dead button on a page somebody is paying for clicks to.
            <p className="text-sm text-ink-600">
              WhatsApp chat isn&apos;t set up yet. Please try again shortly.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
