// Manually-curated incident log for the public /status page. There's no
// automated incident-detection system (see src/lib/publicstatus.ts) — add an
// entry here by hand when something customer-visible breaks. Newest first.

export type Incident = { date: string; title: string; body: string; resolved: boolean };

export const INCIDENTS: Incident[] = [];
