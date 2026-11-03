// "Open this review" from outside the Reviews tab (the alert bell, a desktop
// notification). The tab may not be mounted yet, so the request waits here
// until it is; if it is already open, an event tells it straight away.

const EVENT = "talko:open-review";
let pending: string | null = null;

/** Ask the Reviews tab to open one review. */
export function requestReviewFocus(id: string): void {
  pending = id;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** The review waiting to be opened, if any — once. */
export function takeReviewFocus(): string | null {
  const id = pending;
  pending = null;
  return id;
}

/** Call `fn` whenever a review is asked for while the tab is open. Returns the unsubscribe. */
export function onReviewFocus(fn: (id: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const h = (e: Event) => { pending = null; fn((e as CustomEvent<string>).detail); };
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** The review id in an alert link (/admin?tab=reviews&review=<id>), if any. Pure. */
export function reviewIdFromHref(href: string): string | null {
  try { return new URL(href, "https://x.invalid").searchParams.get("review"); } catch { return null; }
}
