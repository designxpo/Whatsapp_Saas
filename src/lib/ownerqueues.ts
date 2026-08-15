// Owner console — work queues, and the plumbing the tenant list needs to page
// through 100k rows.
//
// The operating model: at fleet scale nobody browses tenants, they work queues.
// A queue is a saved filter with a reason to exist — "these accounts need a human
// today, oldest first". Today renders the counts; the tenant list renders the
// rows behind one of them. Both sides read the same definitions from here.
//
// IMPORTANT: the predicates below must stay in lockstep with owner_queue_counts()
// in supabase/migrations/0106_owner_console.sql. That function answers "how many"
// in one round-trip; these filters answer "which ones" against the same shape.
// A drift between them shows up as a card whose count doesn't match its list, so
// queue-predicates.test.ts asserts the key sets match.
//
// Pure module — no DB, no React. The route applies the descriptors; the tests
// assert them as data.

export type QueueKey =
  | "payment_failed" | "suspended" | "trial_ending" | "trial_expired"
  | "wa_quality" | "marketing_paused" | "integrations_errored" | "channel_silent"
  | "no_channel" | "no_ai_key"
  | "near_limit";

export type QueueGroup = "revenue" | "delivery" | "onboarding" | "growth";

export interface QueueDef {
  key: QueueKey;
  title: string;
  /** One line, in the operator's language: what's wrong and what it costs. */
  why: string;
  group: QueueGroup;
  severity: "critical" | "warn" | "info";
  /**
   * live    — reads columns on `tenants`, so it is never stale.
   * derived — reads tenant_metrics, refreshed on a rotation; the UI shows "as of".
   * Money and trials are deliberately all `live`.
   */
  source: "live" | "derived";
}

export const QUEUE_GROUPS: { key: QueueGroup; title: string }[] = [
  { key: "revenue", title: "Revenue at risk" },
  { key: "delivery", title: "Delivery broken" },
  { key: "onboarding", title: "Onboarding stalled" },
  { key: "growth", title: "Growth" },
];

export const QUEUES: QueueDef[] = [
  { key: "payment_failed", group: "revenue", severity: "critical", source: "live",
    title: "Payment failed", why: "A charge was declined. Broadcasts stop until it clears." },
  { key: "suspended", group: "revenue", severity: "critical", source: "live",
    title: "Suspended", why: "Stripe gave up retrying. The workspace is paused." },
  { key: "trial_expired", group: "revenue", severity: "warn", source: "live",
    title: "Trial expired, unpaid", why: "The trial ended and no payment followed." },
  { key: "trial_ending", group: "growth", severity: "warn", source: "live",
    title: "Trial ending ≤3 days", why: "Still time to convert them." },

  { key: "wa_quality", group: "delivery", severity: "critical", source: "derived",
    title: "WhatsApp quality", why: "Meta flagged the number. Sending is throttled or blocked." },
  { key: "marketing_paused", group: "delivery", severity: "critical", source: "derived",
    title: "Marketing paused", why: "Marketing templates are auto-paused on this number." },
  { key: "integrations_errored", group: "delivery", severity: "warn", source: "derived",
    title: "Integration errors", why: "A connected tool is rejecting deliveries." },
  { key: "channel_silent", group: "delivery", severity: "warn", source: "derived",
    title: "Nothing received in 7 days", why: "A connected channel has gone quiet — often a broken webhook." },

  { key: "no_channel", group: "onboarding", severity: "warn", source: "derived",
    title: "No channel connected", why: "Signed up over 3 days ago and never connected anything." },
  { key: "no_ai_key", group: "onboarding", severity: "info", source: "derived",
    title: "No AI key", why: "Signed up over 3 days ago with no AI configured — replies can't run." },

  { key: "near_limit", group: "growth", severity: "info", source: "derived",
    title: "Near a plan limit", why: "At 80%+ of a plan resource. An upgrade conversation." },
];

// Null-prototype: a plain object literal would answer `"__proto__" in obj` with
// true, so an unvalidated ?queue= param could pass the guard and then fall
// through the switch below with no filters — i.e. match the entire fleet.
export const QUEUE_BY_KEY: Record<string, QueueDef> =
  Object.assign(Object.create(null), Object.fromEntries(QUEUES.map(q => [q.key, q])));

const QUEUE_KEYS = new Set<string>(QUEUES.map(q => q.key));
export function isQueueKey(s: string): s is QueueKey {
  return QUEUE_KEYS.has(s);
}

// ── Filter descriptors ────────────────────────────────────────────────────────
// Data, not query-builder calls, so a test can assert exactly what a queue means
// without a database. The route walks these onto a supabase-js query.
//
// `col` is either a tenants column, or "tenant_metrics.x" for the embedded row —
// which the route selects with !inner so the filter constrains the parent.

export type Filter =
  | { op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; col: string; val: string | number | boolean }
  | { op: "in" | "notIn"; col: string; val: (string | number)[] }
  | { op: "isNull"; col: string }
  /**
   * Raw PostgREST or-expression, for the handful of predicates that need it.
   * `referencedTable` scopes the OR to an embedded row — without it PostgREST
   * would apply the expression to `tenants` and find no such columns.
   */
  | { op: "or"; expr: string; referencedTable?: string };

const ALIVE: Filter = { op: "notIn", col: "status", val: ["suspended", "cancelled"] };
const NOT_PAYING: Filter = { op: "in", col: "payment_status", val: ["trialing", "none"] };
const STALE_SIGNUP = (now: Date): Filter =>
  ({ op: "lt", col: "created_at", val: daysFrom(now, -3) });

function daysFrom(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/**
 * The rows behind one queue card. `now` is injected so the tests are not
 * time-dependent and so a request uses one consistent instant throughout.
 */
export function queueFilters(key: QueueKey, now: Date = new Date()): Filter[] {
  switch (key) {
    case "payment_failed":
      return [{ op: "eq", col: "payment_status", val: "past_due" }];
    case "suspended":
      return [{ op: "eq", col: "status", val: "suspended" }];
    case "trial_ending":
      return [
        { op: "gte", col: "trial_ends_at", val: now.toISOString() },
        { op: "lte", col: "trial_ends_at", val: daysFrom(now, 3) },
        NOT_PAYING,
      ];
    case "trial_expired":
      return [
        { op: "lt", col: "trial_ends_at", val: now.toISOString() },
        NOT_PAYING,
        ALIVE,
      ];

    case "wa_quality":
      // RED outright, or Meta has flagged/restricted the number.
      return [{ op: "or", expr: "wa_quality.eq.RED,wa_health.in.(FLAGGED,RESTRICTED)", referencedTable: "tenant_metrics" }];
    case "marketing_paused":
      return [{ op: "eq", col: "tenant_metrics.marketing_paused", val: true }];
    case "integrations_errored":
      return [{ op: "gt", col: "tenant_metrics.integrations_errored", val: 0 }];
    case "channel_silent":
      // Has channels, but nothing has arrived on any of them in a week.
      return [
        { op: "gt", col: "tenant_metrics.channels", val: 0 },
        { op: "lt", col: "tenant_metrics.last_inbound_at", val: daysFrom(now, -7) },
      ];

    case "no_channel":
      return [{ op: "eq", col: "tenant_metrics.channels", val: 0 }, STALE_SIGNUP(now), ALIVE];
    case "no_ai_key":
      return [{ op: "eq", col: "tenant_metrics.ai_configured", val: false }, STALE_SIGNUP(now), ALIVE];

    case "near_limit":
      return [{ op: "gte", col: "tenant_metrics.usage_pct_max", val: 80 }, ALIVE];
  }
}

/** Does this queue need the metrics row joined? Decides !inner on the select. */
export function queueNeedsMetrics(key: QueueKey): boolean {
  return QUEUE_BY_KEY[key]?.source === "derived";
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Operator search is "whatever the customer told me" — a company fragment, an
 * email, a phone, a slug. Strips the PostgREST pattern metacharacters so a stray
 * comma or paren can't break out of the or() expression, and caps the length so
 * a pasted essay can't build a pathological ILIKE.
 */
export function sanitizeSearch(raw: string): string {
  return (raw || "").trim().slice(0, 80).replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();
}

/** The PostgREST or-expression for a search term, or null when there's nothing to match. */
export function searchExpr(raw: string): string | null {
  const q = sanitizeSearch(raw);
  if (q.length < 2) return null;   // one character matches most of the fleet
  const like = `*${q}*`;
  const cols = ["company", "owner_email", "name", "slug", "owner_phone"];
  return cols.map(c => `${c}.ilike.${like}`).join(",");
}

// ── Keyset pagination ─────────────────────────────────────────────────────────
// Offset pagination degrades linearly — page 500 of a 100k list makes Postgres
// walk 25,000 rows to throw them away. Keyset on (created_at desc, id desc) is
// flat, and tenants_keyset_idx backs it exactly.

export interface Cursor { createdAt: string; id: string }

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt}|${c.id}`, "utf8").toString("base64url");
}

/** Never throws — a mangled cursor means "start from the beginning", not a 500. */
export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s) return null;
  try {
    const [createdAt, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch { return null; }
}

/**
 * The "everything strictly after this cursor" predicate, in PostgREST's or()
 * syntax: an older timestamp, or the same timestamp with a smaller id.
 */
export function cursorExpr(c: Cursor): string {
  return `created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`;
}

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}
