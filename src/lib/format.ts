// Number, money and date formatting for the portal, in Indian conventions
// (1,23,456 grouping, ₹) whatever the browser's own locale is. Pure functions,
// so screens show the same thing on every device.

const IN = "en-IN";
const numberFmt = new Intl.NumberFormat(IN);
const inrFmt = new Intl.NumberFormat(IN, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPaiseFmt = new Intl.NumberFormat(IN, { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** 123456 → "1,23,456". Anything that isn't a number → "—". */
export function fmtNum(n: number | null | undefined): string {
  return finite(n) ? numberFmt.format(n) : "—";
}

/** Rupees: 123456 → "₹1,23,456"; with paise → "₹1,23,456.50". */
export function fmtInr(n: number | null | undefined, opts: { paise?: boolean } = {}): string {
  if (!finite(n)) return "—";
  return (opts.paise ? inrPaiseFmt : inrFmt).format(n);
}

/** A share as a whole percent: 0.8123 → "81%" (or pass a 0–100 value with { of100: true }). */
export function fmtPct(n: number | null | undefined, opts: { of100?: boolean } = {}): string {
  if (!finite(n)) return "—";
  return `${Math.round(opts.of100 ? n : n * 100)}%`;
}

/** "2026-11-06" or an ISO time → "6 Nov" (adds the year when it isn't `now`'s year). */
export function fmtDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** How long ago, in words a shop owner reads at a glance: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function fmtAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** A waiting time, short enough for a list row: "4 min", "2 h 5 min", "3 days". */
export function fmtWait(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

/** "Updated 2 min ago" for a fetch time (ms). */
export function fmtUpdated(at: number | null | undefined, now: number = Date.now()): string {
  if (!finite(at)) return "Not updated yet";
  return `Updated ${fmtAgo(new Date(at).toISOString(), now)}`;
}
