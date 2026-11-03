"use client";
import type { ReactNode } from "react";

export type SegOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; count?: number };

// Shared iOS-style segmented control: a recessed track (bg-canvas) with a single
// raised white active segment. Consolidates the copies that were inlined
// separately in Live Chat and the support desk. Press-in feedback and keyboard
// focus rings come for free from the global button rules in globals.css; this
// adds the correct tablist/tab + aria-selected semantics they were missing.
export function SegmentedControl<T extends string>({
  options, value, onChange, size = "md", ariaLabel, className = "",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={`flex max-w-full overflow-x-auto gap-1 p-0.5 bg-canvas rounded-control ${className}`}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={e => {
              const index = options.findIndex(option => option.value === o.value);
              const next = e.key === "ArrowRight" ? (index + 1) % options.length
                : e.key === "ArrowLeft" ? (index - 1 + options.length) % options.length
                : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
              if (next < 0) return;
              e.preventDefault();
              onChange(options[next].value);
              const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
              buttons?.[next]?.focus();
            }}
            onClick={() => onChange(o.value)}
            className={`flex-1 shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 rounded-[7px] px-2 py-1.5 font-bold transition-colors ${size === "sm" ? "text-[11px]" : "text-[12px]"} ${on ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
            {typeof o.count === "number" && <span className="opacity-60">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
