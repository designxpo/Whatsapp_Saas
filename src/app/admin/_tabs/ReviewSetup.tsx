"use client";

// Getting started with Google Reviews: the steps from plan to first reply, each
// ticked off from what's really set up, with plain answers to the questions an
// owner has before connecting (which account, what Talko can do, automatic vs
// approved replies, disconnecting, pasted vs imported reviews). Admins only;
// can be hidden, and hides itself once everything is done.

import { useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

const HIDE_KEY = "talko-reviews-setup-hidden";
export const PREVIEWED_KEY = "talko-reviews-previewed";

export function ReviewSetup({ locations, settingsSaved, lastSync, onOpenSettings }: {
  locations: number; settingsSaved: boolean; lastSync: string | null; onOpenSettings: () => void;
}) {
  const [hidden, setHidden] = useState(true);
  const [previewed, setPreviewed] = useState(false);
  const [requestsOn, setRequestsOn] = useState<boolean | null>(null);

  useEffect(() => {
    try { setHidden(localStorage.getItem(HIDE_KEY) === "1"); setPreviewed(localStorage.getItem(PREVIEWED_KEY) === "1"); } catch { setHidden(false); }
    fetch("/api/admin/review-booster").then(r => (r.ok ? r.json() : null)).then(d => setRequestsOn(d ? !!d.config?.enabled : null)).catch(() => setRequestsOn(null));
  }, []);

  const next = lastSync ? Math.max(0, Math.round((Date.parse(lastSync) + 5 * 60_000 - Date.now()) / 60_000)) : null;
  const steps: { done: boolean; title: string; body: string; action?: { label: string; href?: string; onClick?: () => void } }[] = [
    { done: true, title: "Your plan includes Google Reviews", body: "Creator Pro, Growth and Scale include it." },
    { done: locations > 0, title: "Connect the Google account that manages your business", body: "Sign in with the Google account that owns or manages your Business Profile.", action: locations ? undefined : { label: "Connect with Google", href: "/api/admin/onboarding/google-reviews/start" } },
    { done: locations > 0, title: "Choose your business location", body: "Pick it right after signing in. Connect each branch the same way." },
    { done: settingsSaved, title: "Choose reply and approval settings", body: "Your kind of business, which replies may post on their own, and what always needs your approval.", action: { label: "Open settings", onClick: onOpenSettings } },
    { done: previewed, title: "Preview an example reply", body: "Settings → Approval → Test your rules. Nothing is posted.", action: { label: "Try it", onClick: onOpenSettings } },
    { done: requestsOn === true, title: "Ask customers for reviews (optional)", body: "Review requests below send one WhatsApp message after a paid order or service." },
    { done: !!lastSync, title: "Check the connection", body: lastSync ? `Last synced ${new Date(lastSync).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}${next != null ? ` · next check in about ${next || 1} min` : ""}.` : "The first sync runs within about 5 minutes of connecting." },
  ];
  const remaining = steps.filter(s => !s.done).length;
  if (hidden || remaining === 0) return null;

  const hide = () => { try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* this visit only */ } setHidden(true); };
  return (
    <section className="rounded-card border border-brand-100 bg-white p-4 space-y-3" aria-label="Set up Google Reviews">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink-900">Set up Google Reviews</p>
          <p className="text-[12px] text-ink-500">{steps.length - remaining} of {steps.length} done</p>
        </div>
        <button onClick={hide} className="-m-1 grid h-9 w-9 place-items-center rounded-control text-ink-400 hover:bg-canvas hover:text-ink-900" aria-label="Hide the setup checklist" title="Hide"><X className="h-4 w-4" /></button>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap sm:flex-nowrap items-start gap-x-2.5 gap-y-1.5">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-600 text-white" : "border border-line text-ink-500"}`} aria-hidden>{s.done ? <Check className="h-3 w-3" /> : i + 1}</span>
            {/* On a phone the step's button drops under its text instead of
                squeezing the text into a narrow column beside it. */}
            <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.875rem)]">
              <p className={`text-[13px] font-semibold ${s.done ? "text-ink-500" : "text-ink-900"}`}>{s.title}<span className="sr-only">{s.done ? " — done" : " — to do"}</span></p>
              {!s.done && <p className="text-[12px] text-ink-600">{s.body}</p>}
            </div>
            {!s.done && s.action && (s.action.href
              ? <a href={s.action.href} className="inline-flex min-h-8 shrink-0 max-sm:ml-[1.875rem] items-center rounded-control bg-blue-600 px-2.5 py-1 text-[12px] font-bold text-white hover:bg-blue-500">{s.action.label}</a>
              : <button onClick={s.action.onClick} className="min-h-8 shrink-0 max-sm:ml-[1.875rem] rounded-control border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:bg-canvas">{s.action.label}</button>)}
          </li>
        ))}
      </ol>
      <details className="group rounded-control bg-canvas px-3 py-2 text-[12px] text-ink-700">
        <summary className="flex cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">Good to know before you connect <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
        <dl className="mt-2 space-y-2">
          <div><dt className="font-semibold">Which Google account?</dt><dd>The one that owns or manages your Business Profile on Google. A personal account that isn&apos;t a manager won&apos;t see your business.</dd></div>
          <div><dt className="font-semibold">What can Talko do?</dt><dd>Read your reviews and post replies as your business — nothing else on your Google account.</dd></div>
          <div><dt className="font-semibold">Automatic or approved replies?</dt><dd>Automatic replies post on their own for the ratings you choose, unless the review raises a refund, safety, legal or personal matter or a strong complaint — those always wait for you. Choose “Off” to approve every reply.</dd></div>
          <div><dt className="font-semibold">How do I disconnect?</dt><dd>Manage locations → the unlink icon next to a location. Talko stops reading it and can&apos;t post there; imported reviews stay; other locations aren&apos;t affected. You can also remove access from your Google account&apos;s security settings.</dd></div>
          <div><dt className="font-semibold">Pasted reviews vs Google reviews?</dt><dd>Reviews from connected locations arrive automatically and can be replied to on Google from here. A pasted review (from anywhere) gets a drafted reply you copy and post yourself — Talko can&apos;t publish it.</dd></div>
        </dl>
      </details>
    </section>
  );
}
