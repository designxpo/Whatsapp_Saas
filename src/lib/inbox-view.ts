// The inbox's filters and sort, as pure functions so the list, its counts and
// the tests share one definition.
//
// "Waiting for you" means exactly what agent alerts mean (waitingForTeam in
// store.ts, /api/admin/inbox/waiting): still needs a reply, from the last 24
// hours, active or handed over, and either handed to the team, taken over by a
// person, or unanswered for UNANSWERED_AFTER_MS. Chats the endpoint itself
// reported (ready to pay, an approval waiting, or every chat while the AI is
// off) are added by id, so the list and the alert count agree.

export type InboxFilter = "all" | "waiting" | "mine" | "unassigned" | "needs_person" | "ai_paused";
export type InboxSort = "longest" | "newest";

export const INBOX_FILTERS: readonly { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting for you" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "Unassigned" },
  { key: "needs_person", label: "Needs a person" },
  { key: "ai_paused", label: "AI paused" },
];
export const INBOX_SORTS: readonly { key: InboxSort; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "longest", label: "Longest waiting" },
];

/** Older links and Home cards still say needs_reply / escalated / bot_off. */
const ALIASES: Record<string, InboxFilter> = {
  needs_reply: "waiting", awaiting: "waiting",
  escalated: "needs_person", needs_a_person: "needs_person",
  bot_off: "ai_paused", human: "ai_paused", paused: "ai_paused",
};

/** Any filter key (current or old) → a current one; unknown → "all". */
export function normalizeFilter(raw: unknown): InboxFilter {
  if (typeof raw !== "string") return "all";
  if (INBOX_FILTERS.some(f => f.key === raw)) return raw as InboxFilter;
  return ALIASES[raw] ?? "all";
}
export function normalizeSort(raw: unknown): InboxSort {
  return raw === "longest" ? "longest" : "newest";
}

/** Mirrors UNANSWERED_AFTER_MS in store.ts (kept here so this stays client-safe). */
export const AI_GRACE_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InboxChat {
  id: string;
  status: string;
  botEnabled: boolean;
  needsReply?: boolean;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  assignedTo?: string | null;
}

/** A chat waiting for a person (see the header). `alerted` = ids from /api/admin/inbox/waiting. */
export function isWaitingForPerson(c: InboxChat, now: number = Date.now(), alerted?: ReadonlySet<string>): boolean {
  if (alerted?.has(c.id)) return true;
  if (!c.needsReply || !c.lastInboundAt) return false;
  if (c.status !== "active" && c.status !== "escalated") return false;
  const at = Date.parse(c.lastInboundAt);
  if (Number.isNaN(at) || now - at > DAY_MS) return false;
  return c.status === "escalated" || c.botEnabled === false || now - at >= AI_GRACE_MS;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Assigned to the signed-in person — by name or email, as today.ts decides `mine`. */
export function isMine(assignedTo: string | null | undefined, me: { name?: string | null; email?: string | null } | null | undefined): boolean {
  if (!me || !assignedTo) return false;
  return same(assignedTo, me.name) || same(assignedTo, me.email);
}

export interface FilterContext {
  now?: number;
  me?: { name?: string | null; email?: string | null } | null;
  alerted?: ReadonlySet<string>;
}

export function matchesFilter(c: InboxChat, f: InboxFilter, ctx: FilterContext = {}): boolean {
  switch (f) {
    case "waiting": return isWaitingForPerson(c, ctx.now, ctx.alerted);
    case "mine": return isMine(c.assignedTo, ctx.me);
    case "unassigned": return !c.assignedTo;
    case "needs_person": return c.status === "escalated";
    case "ai_paused": return c.botEnabled === false;
    default: return true;
  }
}

/** How many chats each filter would show. */
export function filterCounts(list: InboxChat[], ctx: FilterContext = {}): Record<InboxFilter, number> {
  const out = { all: 0, waiting: 0, mine: 0, unassigned: 0, needs_person: 0, ai_paused: 0 } as Record<InboxFilter, number>;
  for (const c of list) for (const f of INBOX_FILTERS) if (matchesFilter(c, f.key, ctx)) out[f.key]++;
  return out;
}

const ts = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? 0 : t; };
/** The later of the last message in and the last message out. */
export function lastTouchMs(c: InboxChat): number {
  return Math.max(ts(c.lastInboundAt), ts(c.lastOutboundAt));
}

/** Still needs a reply, and the customer wrote in the last 24 hours. */
function awaitingToday(c: InboxChat, now: number): boolean {
  const at = ts(c.lastInboundAt);
  return !!c.needsReply && at > 0 && now - at <= DAY_MS;
}

/**
 * "longest": chats awaiting a reply from the last 24 hours first, the longest
 * wait at the top; then everything else, most recent first (a chat left
 * unanswered for days would otherwise sit on top for good). "newest": most
 * recent first. Returns a new array; ties keep their original order.
 */
export function sortChats<T extends InboxChat>(list: T[], sort: InboxSort, now: number = Date.now()): T[] {
  const indexed = list.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => {
    if (sort === "longest") {
      const wa = awaitingToday(a.c, now) ? 1 : 0;
      const wb = awaitingToday(b.c, now) ? 1 : 0;
      if (wa !== wb) return wb - wa;
      if (wa && wb) { const d = ts(a.c.lastInboundAt) - ts(b.c.lastInboundAt); if (d) return d; }
      else { const d = lastTouchMs(b.c) - lastTouchMs(a.c); if (d) return d; }
      return a.i - b.i;
    }
    return (lastTouchMs(b.c) - lastTouchMs(a.c)) || a.i - b.i;
  });
  return indexed.map(x => x.c);
}

/** Saved per browser tab, so leaving the inbox and coming back keeps your view. */
export const INBOX_VIEW_KEY = "talko-inbox-view";
export function readSavedView(storage: Pick<Storage, "getItem"> | null | undefined): { filter: InboxFilter; sort: InboxSort } {
  try {
    const raw = storage?.getItem(INBOX_VIEW_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return { filter: normalizeFilter(v?.filter), sort: normalizeSort(v?.sort) };
  } catch { return { filter: "all", sort: "newest" }; }
}
export function saveView(storage: Pick<Storage, "setItem"> | null | undefined, v: { filter: InboxFilter; sort: InboxSort }): void {
  try { storage?.setItem(INBOX_VIEW_KEY, JSON.stringify(v)); } catch { /* private mode: this visit only */ }
}
