// Paging for reads whose correctness depends on being COMPLETE.
//
// PostgREST answers with at most `db-max-rows` rows per request — 1,000 on this
// project. `.limit(50_000)` does not raise that ceiling; it just asks for more
// than the server will ever hand over. So a single select silently returns a
// PREFIX of the real result, and the caller cannot tell.
//
// That bit us twice. Audience resolution capped at 1,000 while guarding with
// `rows.length >= 50_000` — a condition that can never be true — so a workspace
// of 1,224 active contacts sent "to all" and quietly reached exactly 1,000
// (found on the internal build; this schema had the identical code).
// optoutSet() had no bound at all, which would have started sending to people
// who had opted out the moment the list passed 1,000.
//
// Use this anywhere a truncated answer would be wrong rather than merely short.
// For display or sampling, a plain .limit() is fine and cheaper.

export const PAGE_SIZE = 1000;

// Minimal shape of a Supabase query builder at the point it is awaited. Kept
// structural so this works for any table without importing generated types.
interface Pageable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Reads every row a query matches, one page at a time.
 *
 * `build` must return a FRESH builder each call — a Supabase builder cannot be
 * awaited twice — and MUST impose a stable sort. Without an ORDER BY, Postgres
 * gives no ordering guarantee between requests, so rows can repeat on one page
 * and be missed on the next: silent corruption that looks like success.
 *
 * `cap` is a runaway guard, not an expected limit. Reaching it is logged.
 */
export async function pageAll<T>(
  build: () => Pageable<T>,
  opts: { cap?: number; label?: string } = {},
): Promise<T[]> {
  const cap = opts.cap ?? 100_000;
  const out: T[] = [];
  while (out.length < cap) {
    const to = Math.min(out.length + PAGE_SIZE, cap) - 1;
    const { data, error } = await build().range(out.length, to);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    // A short page is the end of the result set. Anything else means there is
    // more to read, however large .limit() claimed the ceiling was.
    if (rows.length < PAGE_SIZE) return out;
  }
  console.warn(JSON.stringify({ tag: "paged_select_capped", cap, label: opts.label ?? "unknown" }));
  return out;
}
