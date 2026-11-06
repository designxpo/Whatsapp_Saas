"use client";

// One date-range control for every data screen (Analytics, Results, Team
// Progress, Review reports), plus the header it sits in and the "Updated 2 min
// ago" line under it. Each screen used to have its own picker — a segmented
// row, a tab row, a dropdown — with different windows and names.
//
// Semantics are a radio group: one choice of several, Tab lands on the chosen
// one, arrow keys move and choose (WAI-ARIA radio pattern). On a phone the
// buttons share the full width under the title and use the short names.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2 } from "lucide-react";
import { customRangeProblem, isoDay, type PresetKey, type RangePreset } from "@/lib/analytics-range";
import { fmtUpdated } from "@/lib/format";

export interface CustomDates {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Longest allowed span in days (the API's own limit). */
  maxDays?: number;
}

/** Which option an arrow/Home/End key moves to from `i` (wraps like a radio group). Pure. */
export function nextIndex(key: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (i + 1) % n;
  if (key === "ArrowLeft" || key === "ArrowUp") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

export function DateRange({ options, value, onChange, custom, label = "Date range", className = "" }: {
  options: RangePreset[];
  value: PresetKey;
  onChange: (key: PresetKey) => void;
  custom?: CustomDates;
  label?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = options;
  const selected = Math.max(0, list.findIndex(o => o.key === value));
  const today = isoDay(new Date());
  const problem = value === "custom" && custom ? customRangeProblem(custom.from, custom.to, { maxDays: custom.maxDays, today }) : null;

  function onKey(e: React.KeyboardEvent, i: number) {
    const j = nextIndex(e.key, i, list.length);
    if (j === null) return;
    e.preventDefault();
    onChange(list[j].key);
    refs.current[j]?.focus();
  }

  return (
    <div className={`flex w-full flex-col gap-2 sm:w-auto sm:items-end ${className}`}>
      <div role="radiogroup" aria-label={label} className="flex w-full flex-wrap gap-0.5 rounded-control border border-line bg-white p-0.5 sm:w-auto">
        {list.map((o, i) => {
          const on = i === selected;
          return (
            <button
              key={o.key}
              ref={el => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.key)}
              onKeyDown={e => onKey(e, i)}
              className={`min-h-8 flex-1 whitespace-nowrap rounded-[7px] px-2.5 text-[12px] font-semibold transition-colors sm:flex-none sm:px-3 ${on ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-canvas hover:text-ink-900"}`}
            >
              <span className="sm:hidden">{o.short}</span>
              <span className="hidden sm:inline">{o.label}</span>
            </button>
          );
        })}
      </div>
      {value === "custom" && custom && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[12px] font-semibold text-ink-600">
            <span className="block">From</span>
            <input type="date" value={custom.from} max={custom.to || today} onChange={e => custom.onChange(e.target.value, custom.to)}
              aria-invalid={!!problem} className="min-h-9 rounded-control border border-line bg-white px-2.5 text-[13px] text-ink-900" />
          </label>
          <label className="space-y-1 text-[12px] font-semibold text-ink-600">
            <span className="block">To</span>
            <input type="date" value={custom.to} min={custom.from} max={today} onChange={e => custom.onChange(custom.from, e.target.value)}
              aria-invalid={!!problem} className="min-h-9 rounded-control border border-line bg-white px-2.5 text-[13px] text-ink-900" />
          </label>
          {problem && <p role="alert" className="w-full text-[12px] font-medium text-red-700 sm:text-right">{problem}</p>}
        </div>
      )}
    </div>
  );
}

/** Re-renders every `ms` so a relative time ("2 min ago") stays true. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * "Updating…" with a spinner while a new range loads (the old figures stay on
 * screen, dimmed), then "Updated 2 min ago". Announced politely.
 */
export function LoadStatus({ loading, updatedAt, className = "" }: { loading: boolean; updatedAt: number | null; className?: string }) {
  const now = useNow();
  return (
    <p role="status" aria-live="polite" className={`flex items-center gap-1.5 text-[12px] text-ink-500 ${className}`}>
      {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Updating…</> : updatedAt ? fmtUpdated(updatedAt, Math.max(now, updatedAt)) : null}
    </p>
  );
}

/** A plain "Download CSV" button for the header row. */
export function ExportCsvButton({ onClick, disabled, label = "Download CSV" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-control border border-line bg-white px-3 text-[12px] font-semibold text-ink-700 hover:bg-canvas disabled:opacity-50">
      <Download className="h-3.5 w-3.5" aria-hidden /> {label}
    </button>
  );
}

/**
 * The top of a data screen: title and one line of explanation on the left;
 * the date range (and any other controls) top-right, wrapping under the title
 * on a phone.
 */
export function DataPageHeader({ title, icon, subtitle, controls, status }: {
  title: string; icon?: ReactNode; subtitle?: ReactNode; controls?: ReactNode; status?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">{icon}{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-600">{subtitle}</p>}
        {status}
      </div>
      {controls && <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">{controls}</div>}
    </header>
  );
}
