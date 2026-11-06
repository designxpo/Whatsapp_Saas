"use client";

// Shared chart pieces for the data screens. No chart library: small SVG/HTML
// marks, but every value can be read three ways —
//   • hover (or touch) a point or bar for its date and numbers,
//   • Tab to the chart and use the arrow keys (the reading is announced),
//   • "Show as table" under the chart, for anyone who'd rather read rows.
//
// Colours: data series use the brand blues; emerald / amber / red are kept for
// good / warning / bad and never used as a series colour. Text is 11px or more.
// Motion is limited to short colour/position transitions, which the global
// prefers-reduced-motion rule (globals.css) collapses.

import { useId, useState, type ReactNode } from "react";

// ── Colours ───────────────────────────────────────────────────────────────────
/** Series colours — the brand scale from tailwind.config.ts. */
export const SERIES_COLORS = {
  primary: "#0783FD",   // brand-700
  secondary: "#084FA3", // brand-900
  tertiary: "#4DA3FF",  // brand-500
} as const;
/** Status colours — only for good / warning / bad, never for a data series. */
export const STATUS_COLORS = { good: "#059669", warn: "#D97706", bad: "#DC2626" } as const;
const GRID = "#EEF2F7";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ChartPoint {
  /** Stable key (a date or bucket key). */
  key: string;
  /** Short label for the axis — "6 Nov". */
  label: string;
  /** Fuller label for the tooltip and table — "Week of 3 Nov". Defaults to `label`. */
  title?: string;
  values: Record<string, number | null | undefined>;
}
export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
  /** How the series is drawn. "none" = tooltip and table only. */
  mark?: "area" | "line" | "dashed" | "none";
  format?: (n: number) => string;
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────
const plain = (n: number) => new Intl.NumberFormat("en-IN").format(n);

/** Up to `max` evenly spread indices for axis labels, always including the first and last. */
export function tickIndices(n: number, max = 6): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}

/** The point nearest a horizontal position (0 = left edge, 1 = right edge). */
export function indexAtFraction(f: number, n: number): number {
  if (n <= 1) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(Math.min(1, Math.max(0, f)) * (n - 1))));
}

/** Where a point sits horizontally, 0–1. A single point sits in the middle. */
export function xFraction(i: number, n: number): number {
  return n <= 1 ? 0.5 : i / (n - 1);
}

/** The y range a chart draws over: from zero, or fitted around the data (e.g. star ratings). */
export function yDomain(values: number[], fit = false): { min: number; max: number } {
  const v = values.filter(x => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 1 };
  const hi = Math.max(...v), lo = Math.min(...v);
  if (!fit) return { min: 0, max: Math.max(1, hi) };
  const pad = Math.max(0.1, (hi - lo) * 0.15);
  return { min: lo - pad, max: hi + pad };
}

export interface TooltipData { title: string; rows: { label: string; value: string; color?: string }[]; text: string }

/** What the tooltip (and the screen-reader announcement) says for one point. */
export function tooltipFor(point: ChartPoint, series: ChartSeries[]): TooltipData {
  const title = point.title ?? point.label;
  const rows = series.map(s => {
    const v = point.values[s.key];
    return { label: s.label, value: typeof v === "number" && Number.isFinite(v) ? (s.format ?? plain)(v) : "—", color: s.mark === "none" ? undefined : s.color };
  });
  return { title, rows, text: `${title}: ${rows.map(r => `${r.label} ${r.value}`).join(", ")}` };
}

/** Rows for the "Show as table" view: first column the point's title, then one per series. */
export function tableRows(points: ChartPoint[], series: ChartSeries[]): string[][] {
  return points.map(p => [p.title ?? p.label, ...tooltipFor(p, series).rows.map(r => r.value)]);
}

/** How a change between two periods reads: arrow, word for screen readers, sentence. */
export function deltaText(change: number, unit: "%" | "points" | "", comparison: string): { arrow: "▲" | "▼" | ""; word: string; text: string } {
  const n = Math.round(Math.abs(change));
  if (n === 0) return { arrow: "", word: "", text: `No change vs ${comparison}` };
  const amount = unit === "%" ? `${plain(n)}%` : unit === "points" ? `${plain(n)} point${n === 1 ? "" : "s"}` : plain(n);
  return { arrow: change > 0 ? "▲" : "▼", word: change > 0 ? "Up" : "Down", text: `${amount} vs ${comparison}` };
}

// ── Cursor: which point is being read, by pointer or keyboard ────────────────
function useCursor(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, i));
  const handlers = {
    tabIndex: n ? 0 : -1,
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width > 0) setActive(indexAtFraction((e.clientX - r.left) / r.width, n));
    },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width > 0) setActive(indexAtFraction((e.clientX - r.left) / r.width, n));
    },
    onPointerLeave: () => { if (!focused) setActive(null); },
    onFocus: () => { setFocused(true); setActive(a => a ?? n - 1); },
    onBlur: () => { setFocused(false); setActive(null); },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const cur = active ?? n - 1;
      let next: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next = clamp(cur + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = clamp(cur - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      else if (e.key === "Escape") { setActive(null); return; }
      if (next !== null) { e.preventDefault(); setActive(next); }
    },
  };
  return { active: active !== null && active < n ? active : null, handlers };
}

function Tooltip({ data, fraction }: { data: TooltipData; fraction: number }) {
  // Beside the guide line rather than over the points it marks; flips to the
  // left past the middle so it stays inside the chart.
  const shift = fraction > 0.55 ? "calc(-100% - 12px)" : "12px";
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 z-20 min-w-[132px] rounded-lg bg-ink-900 px-2.5 py-2 text-[12px] text-white shadow-lg"
      style={{ left: `${fraction * 100}%`, transform: `translateX(${shift})` }}>
      <p className="font-bold">{data.title}</p>
      <ul className="mt-1 space-y-0.5">
        {data.rows.map(r => (
          <li key={r.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-white/80">{r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}{r.label}</span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Announce({ text }: { text: string }) {
  return <p className="sr-only" aria-live="polite">{text}</p>;
}

/** Colour key for the drawn series. */
export function Legend({ series }: { series: ChartSeries[] }) {
  const drawn = series.filter(s => s.mark !== "none");
  if (drawn.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-600" aria-label="Key">
      {drawn.map(s => (
        <li key={s.key} className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={s.mark === "dashed" ? "4 3" : undefined} /></svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// ── Line / area chart over time ───────────────────────────────────────────────
export function TimeChart({ points, series, label, height = 200, fit = false, yFormat }: {
  points: ChartPoint[];
  series: ChartSeries[];
  /** What the chart shows, for screen readers — "Messages sent per day". */
  label: string;
  height?: number;
  /** Fit the y axis around the data instead of starting at zero (ratings). */
  fit?: boolean;
  yFormat?: (n: number) => string;
}) {
  const n = points.length;
  const { active, handlers } = useCursor(n);
  const drawn = series.filter(s => s.mark !== "none");
  const W = 720, H = height, PAD = 14;
  const all = drawn.flatMap(s => points.map(p => p.values[s.key])).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const { min, max } = yDomain(all, fit);
  const yOf = (v: number) => H - PAD - ((v - min) / Math.max(1e-9, max - min)) * (H - PAD * 2);
  const xOf = (i: number) => xFraction(i, n) * W;
  const pathFor = (key: string) => {
    let d = "", pen = false;
    points.forEach((p, i) => {
      const v = p.values[key];
      if (typeof v !== "number" || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const grid = [0, 0.5, 1].map(f => ({ y: H - PAD - f * (H - PAD * 2), v: min + f * (max - min) }));
  const fmtY = yFormat ?? ((v: number) => plain(Math.round(v)));
  const ticks = tickIndices(n, 6);
  const tip = active !== null ? tooltipFor(points[active], series) : null;
  const gradId = useId().replace(/:/g, "");

  if (!n) return <p className="py-10 text-center text-[13px] text-ink-500">Nothing to show for this period yet.</p>;

  return (
    <div>
      <div
        {...handlers}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. Use the left and right arrow keys to read each point.`}
        className="relative cursor-crosshair touch-pan-y rounded-control outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        style={{ height: H }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={drawn[0]?.color ?? SERIES_COLORS.primary} stopOpacity="0.2" />
              <stop offset="100%" stopColor={drawn[0]?.color ?? SERIES_COLORS.primary} stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((g, i) => <line key={i} x1="0" y1={g.y} x2={W} y2={g.y} stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {drawn.map(s => {
            const d = pathFor(s.key);
            if (!d) return null;
            return (
              <g key={s.key}>
                {s.mark === "area" && n > 1 && <path d={`${d} L ${xOf(n - 1).toFixed(1)} ${H} L ${xOf(0).toFixed(1)} ${H} Z`} fill={`url(#${gradId})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={s.mark === "area" ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={s.mark === "dashed" ? "5 4" : undefined} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
        {/* Y values on the grid lines (HTML so the text isn't stretched). */}
        {grid.slice(1).map((g, i) => (
          <span key={i} aria-hidden className="pointer-events-none absolute left-0 z-[1] -translate-y-full rounded bg-white/85 px-1 text-[11px] tabular-nums text-ink-500" style={{ top: g.y }}>{fmtY(g.v)}</span>
        ))}
        {/* A single point has no line to draw — show it as a dot. */}
        {n === 1 && drawn.map(s => {
          const v = points[0].values[s.key];
          return typeof v === "number" ? <span key={s.key} aria-hidden className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: "50%", top: yOf(v), background: s.color }} /> : null;
        })}
        {active !== null && (
          <>
            <span aria-hidden className="pointer-events-none absolute bottom-0 top-0 w-px bg-ink-300" style={{ left: `${xFraction(active, n) * 100}%` }} />
            {drawn.map(s => {
              const v = points[active].values[s.key];
              return typeof v === "number" && Number.isFinite(v) ? (
                <span key={s.key} aria-hidden className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                  style={{ left: `${xFraction(active, n) * 100}%`, top: yOf(v), background: s.color }} />
              ) : null;
            })}
            {tip && <Tooltip data={tip} fraction={xFraction(active, n)} />}
          </>
        )}
      </div>
      <div className="relative mt-1.5 h-4" aria-hidden>
        {ticks.map(i => {
          const f = xFraction(i, n);
          const shift = f < 0.05 ? "0%" : f > 0.95 ? "-100%" : "-50%";
          return <span key={points[i].key} className="absolute whitespace-nowrap text-[11px] text-ink-500" style={{ left: `${f * 100}%`, transform: `translateX(${shift})` }}>{points[i].label}</span>;
        })}
      </div>
      <Legend series={series} />
      <Announce text={tip?.text ?? ""} />
    </div>
  );
}

// ── Column chart (one bar per period) ─────────────────────────────────────────
export function ColumnChart({ points, series, label, height = 112 }: {
  points: ChartPoint[];
  /** The first series sets the bar height; any others show in the tooltip and table. */
  series: ChartSeries[];
  label: string;
  height?: number;
}) {
  const n = points.length;
  const { active, handlers } = useCursor(n);
  const main = series[0];
  const max = Math.max(1, ...points.map(p => Number(p.values[main.key]) || 0));
  const tip = active !== null ? tooltipFor(points[active], series) : null;
  const ticks = tickIndices(n, 5);
  if (!n) return <p className="py-8 text-center text-[13px] text-ink-500">Nothing to show for this period yet.</p>;
  return (
    <div>
      <div
        {...handlers}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. Use the left and right arrow keys to read each bar.`}
        className="relative flex cursor-crosshair touch-pan-y items-end gap-0.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        style={{ height }}
      >
        {points.map((p, i) => {
          const v = Number(p.values[main.key]) || 0;
          return (
            <div key={p.key} aria-hidden className="flex h-full flex-1 flex-col justify-end">
              <div className="rounded-t transition-colors" style={{ height: `${Math.max(v ? 4 : 0, (v / max) * 100)}%`, background: active === i ? SERIES_COLORS.secondary : main.color ?? SERIES_COLORS.primary }} />
            </div>
          );
        })}
        {tip && active !== null && <Tooltip data={tip} fraction={(active + 0.5) / n} />}
      </div>
      <div className="relative mt-1.5 h-4" aria-hidden>
        {ticks.map(i => {
          const f = (i + 0.5) / n;
          const shift = f < 0.1 ? "0%" : f > 0.9 ? "-100%" : "-50%";
          return <span key={points[i].key} className="absolute whitespace-nowrap text-[11px] text-ink-500" style={{ left: `${f * 100}%`, transform: `translateX(${shift})` }}>{points[i].label}</span>;
        })}
      </div>
      <Announce text={tip?.text ?? ""} />
    </div>
  );
}

// ── Labelled horizontal bars (replaces donuts) ────────────────────────────────
export interface BarItem { label: string; value: number; tone?: "brand" | "bad" | "muted"; note?: string }

/** Each item's share of `total` (or of the items' sum), as a whole percent. Pure. */
export function barShares(items: BarItem[], total?: number): number[] {
  const t = total ?? items.reduce((s, x) => s + Math.max(0, x.value), 0);
  return items.map(x => (t > 0 ? Math.round((Math.max(0, x.value) / t) * 100) : 0));
}

export function HBars({ items, total, label, format = plain }: { items: BarItem[]; total?: number; label: string; format?: (n: number) => string }) {
  const shares = barShares(items, total);
  const colour = (t: BarItem["tone"]) => (t === "bad" ? STATUS_COLORS.bad : t === "muted" ? "#A3A3A3" : SERIES_COLORS.primary);
  return (
    <ul className="space-y-3" aria-label={label}>
      {items.map((x, i) => (
        <li key={x.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink-700">{x.label}{x.note && <span className="ml-1 text-[12px] text-ink-500">{x.note}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums text-ink-900">{format(x.value)} <span className="font-normal text-ink-500">· {shares[i]}%</span></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${x.value > 0 ? Math.max(2, shares[i]) : 0}%`, background: colour(x.tone) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── "Show as table" — the accessible alternative under each main chart ───────
export function ShowAsTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
        className="min-h-8 rounded-control px-2 text-[12px] font-semibold text-brand-800 hover:bg-brand-50">
        {open ? "Hide table" : "Show as table"}
      </button>
      <div id={id} hidden={!open} className="mt-2 max-h-80 overflow-auto rounded-control border border-line">
        {open && (
          <table className="w-full text-[13px] tabular-nums">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-canvas">
              <tr>{columns.map((c, i) => <th key={c} scope="col" className={`px-3 py-2 text-[12px] font-semibold text-ink-600 ${i ? "text-right" : "text-left"}`}>{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => ci === 0
                  ? <th key={ci} scope="row" className="px-3 py-1.5 text-left font-medium text-ink-900">{c}</th>
                  : <td key={ci} className="px-3 py-1.5 text-right text-ink-700">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── A change between two periods — arrow + words, not colour alone ───────────
export function Delta({ change, unit, comparison, goodWhen = "up" }: {
  change: number; unit: "%" | "points" | ""; comparison: string; goodWhen?: "up" | "down";
}) {
  const d = deltaText(change, unit, comparison);
  const good = d.arrow === "" ? null : goodWhen === "up" ? change > 0 : change < 0;
  const tone = good === null ? "text-ink-500" : good ? "text-emerald-700" : "text-red-700";
  return (
    <p className={`mt-1 text-[12px] font-semibold ${tone}`}>
      {d.arrow && <span aria-hidden>{d.arrow} </span>}
      {d.word && <span className="sr-only">{d.word} </span>}
      {d.text}
    </p>
  );
}

/** A small white card wrapping a chart with its title and an optional line under the title. */
export function ChartCard({ title, sub, aside, children, className = "" }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-white p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {sub && <p className="text-[12px] text-ink-500">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
