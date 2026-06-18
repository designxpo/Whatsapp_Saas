// Hardening for user-supplied values that flow into PostgREST/SQL LIKE filters.
//
// Two distinct risks are covered:
//  1. LIKE wildcard injection — a search for "%" or "_" otherwise matches every
//     row (a silent filter bypass), since ILIKE treats them as wildcards.
//  2. PostgREST .or() string injection — .or("name.ilike.%x%,phone.ilike.%x%")
//     is a parsed mini-grammar where "," separates conditions, "()" group, and
//     '"' quotes. A search term containing those could inject extra conditions.

// Escape the three LIKE metacharacters so they match literally. Postgres LIKE's
// default escape character is backslash, which PostgREST passes through.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

// Safe to embed inside a PostgREST .or()/filter string: LIKE wildcards escaped,
// and the grammar delimiters (, ) " neutralized to spaces. Trimmed so an
// all-special-character term collapses to "" and the caller can skip the filter
// instead of applying a match-all.
export function safeFilterValue(s: string): string {
  return escapeLike(s).replace(/[,()"]/g, " ").trim();
}

// Restrict a JSONB attribute key to identifier-safe characters before it is
// interpolated into a column reference (attributes->>key). Anything else is
// dropped — a malformed key degrades to "no match", never a broken/injected
// filter.
export function safeAttrKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "").trim();
}
