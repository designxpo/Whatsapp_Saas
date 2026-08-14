// Public holidays & festivals via the free, no-auth Nager.Date API. Non-PII, so
// nothing leaves the system but a country + year. Cached in-memory per
// country+year (holidays don't change mid-run). Best-effort: any failure returns
// [] / null so nothing that depends on it ever breaks.
//
// Coverage is national/gazetted holidays plus major festivals (India = "IN":
// Republic Day, Holi, Independence Day, Diwali, …). Calendarific (API key) is a
// richer upgrade for regional festivals if ever needed.

export interface Holiday { date: string; name: string; localName: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, Holiday[]>();

export async function getHolidays(year: number, country = "IN"): Promise<Holiday[]> {
  const key = `${country}-${year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const j = await r.json();
    const list: Holiday[] = (Array.isArray(j) ? j : []).map((h: Record<string, unknown>) => ({
      date: String(h.date ?? ""),
      name: String(h.name ?? ""),
      localName: String(h.localName ?? h.name ?? ""),
    })).filter(h => DATE_RE.test(h.date) && h.name);
    cache.set(key, list);
    return list;
  } catch {
    return [];
  }
}

// The holiday falling on a given date (YYYY-MM-DD or an ISO timestamp), or null.
export async function holidayOn(dateISO: string, country = "IN"): Promise<Holiday | null> {
  const d = (dateISO || "").slice(0, 10);
  if (!DATE_RE.test(d)) return null;
  const list = await getHolidays(Number(d.slice(0, 4)), country);
  return list.find(h => h.date === d) ?? null;
}

// Holidays within the next `days` days (from today, inclusive), each with the
// number of days away. Fetches this year + next year so a window crossing into
// January still surfaces January's festivals. `todayISO` is injectable for tests.
export async function upcomingHolidays(country = "IN", days = 90, todayISO?: string): Promise<(Holiday & { daysAway: number })[]> {
  const now = todayISO ? new Date(todayISO) : new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + days * 86400000;
  const years = Array.from(new Set([new Date(start).getUTCFullYear(), new Date(end).getUTCFullYear()]));
  const all: Holiday[] = [];
  for (const y of years) all.push(...(await getHolidays(y, country)));
  const out: (Holiday & { daysAway: number })[] = [];
  for (const h of all) {
    const hd = Date.parse(`${h.date}T00:00:00Z`);
    if (!Number.isNaN(hd) && hd >= start && hd <= end) out.push({ ...h, daysAway: Math.round((hd - start) / 86400000) });
  }
  out.sort((a, b) => a.daysAway - b.daysAway);
  return out;
}
