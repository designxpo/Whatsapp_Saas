// Currency conversion via the free, no-auth Frankfurter API (ECB reference
// rates, frankfurter.app). Non-PII. Rates move ~daily, so results are cached
// in-memory per base+symbols for 6h. Best-effort: empty rates / null on failure.

export interface Rates { base: string; rates: Record<string, number> }

const cache = new Map<string, { at: number; data: Rates }>();
const TTL_MS = 6 * 60 * 60 * 1000;
const CODE_RE = /^[A-Z]{3}$/;
const code = (c: string) => (c || "").trim().toUpperCase();

// Latest rates from `base` to each of `symbols` (the base itself is dropped).
// Returns { base, rates: {} } on any failure or bad input.
export async function getRates(base: string, symbols: string[]): Promise<Rates> {
  const b = code(base);
  const syms = Array.from(new Set(symbols.map(code).filter(s => CODE_RE.test(s) && s !== b))).sort();
  if (!CODE_RE.test(b) || !syms.length) return { base: b, rates: {} };
  const key = `${b}->${syms.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const url = new URL("https://api.frankfurter.app/latest");
    url.searchParams.set("from", b);
    url.searchParams.set("to", syms.join(","));
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { base: b, rates: {} };
    const j = (await r.json()) as { rates?: Record<string, unknown> };
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(j.rates ?? {})) if (typeof v === "number" && v > 0) rates[code(k)] = v;
    const data: Rates = { base: b, rates };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return { base: b, rates: {} };
  }
}

// Convert `amount` from one currency to another. null on failure; identity when
// the currencies match.
export async function convert(amount: number, from: string, to: string): Promise<number | null> {
  const b = code(from), t = code(to);
  if (b === t) return amount;
  const { rates } = await getRates(b, [t]);
  const rate = rates[t];
  return typeof rate === "number" ? amount * rate : null;
}
