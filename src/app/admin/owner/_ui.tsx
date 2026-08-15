"use client";

// Owner console UI kit.
//
// The console is scanned and operated, not read, so the primitives here lean on
// information density: fixed-width numerics, severity encoded in shape as well as
// colour, and nothing decorative.
//
// Palette note: only ink-400/600/900/950 exist in tailwind.config. ink-300/500/
// 700/800 are used elsewhere in the app but were never defined, so they silently
// emit no colour — nothing here uses them.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Loader2, Search, Check } from "lucide-react";

// ── Formatters ────────────────────────────────────────────────────────────────

export const money = (cents: number, currency = "INR") =>
  `${currency === "INR" ? "₹" : `${currency} `}${Math.round(cents / 100).toLocaleString()}`;

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  : String(n);

/** Coarse buckets — an operator reads "3 days", never "2d 7h 14m". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "unknown";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/** Forward-looking twin of `ago` — "in 2 days", for trials. */
export function until(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms < 0) return `${ago(iso).replace(" ago", "")} overdue`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

const TONES: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  info: "bg-brand-50 text-brand-700 border-brand-100",
  muted: "bg-canvas text-ink-600 border-line",
};

export function Badge({ tone = "muted", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  active: "ok", trialing: "info", suspended: "bad", cancelled: "muted",
};
export const PAYMENT_TONE: Record<string, Tone> = {
  active: "ok", trialing: "info", past_due: "bad", cancelled: "muted", none: "muted",
};

// ── Empty / loading ───────────────────────────────────────────────────────────

export function EmptyState({ icon, title, body }: { icon?: ReactNode; title: string; body?: string }) {
  return (
    <div className="text-center py-14 px-6">
      {icon && <div className="w-10 h-10 rounded-full bg-canvas text-ink-400 flex items-center justify-center mx-auto mb-3">{icon}</div>}
      <p className="text-sm font-bold text-ink-900">{title}</p>
      {body && <p className="text-[13px] text-ink-600 mt-1 max-w-sm mx-auto leading-relaxed">{body}</p>}
    </div>
  );
}

export const Spinner = () => <Loader2 className="w-4 h-4 animate-spin text-ink-400" />;

export function Panel({ title, action, children, dense }: { title?: string; action?: ReactNode; children: ReactNode; dense?: boolean }) {
  return (
    <section className="bg-white rounded-card border border-line overflow-hidden">
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          {title && <h2 className="text-[13px] font-extrabold text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

// ── Metric tile ───────────────────────────────────────────────────────────────

export function MetricTile({ label, value, sub, tone, onClick }: {
  label: string; value: string | number; sub?: string; tone?: Tone; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`text-left bg-white rounded-card border border-line px-4 py-3 w-full ${onClick ? "hover:border-brand-500 transition-colors" : ""}`}>
      <p className="text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em]">{label}</p>
      <p className={`text-2xl font-extrabold tabular-nums leading-tight mt-0.5 ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-ink-900"}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink-600 mt-0.5">{sub}</p>}
    </Tag>
  );
}

// ── Queue card ────────────────────────────────────────────────────────────────
// A queue is only worth showing if it implies an action, so the card always
// carries the reason and the age of the oldest item — a count alone tells an
// operator nothing about whether to act now.

export function QueueCard({ title, why, count, oldest, severity, stale, onClick }: {
  title: string; why: string; count: number; oldest: string | null;
  severity: "critical" | "warn" | "info"; stale?: boolean; onClick: () => void;
}) {
  const clear = count === 0;
  const tone: Tone = clear ? "ok" : severity === "critical" ? "bad" : severity === "warn" ? "warn" : "info";
  const stripe = clear ? "bg-emerald-400" : severity === "critical" ? "bg-red-500" : severity === "warn" ? "bg-amber-400" : "bg-brand-500";
  return (
    <button onClick={onClick} disabled={clear}
      className={`relative text-left bg-white rounded-card border border-line pl-4 pr-3 py-3 w-full overflow-hidden transition-colors ${clear ? "opacity-60" : "hover:border-brand-500"}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${stripe}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink-900">{title}</p>
          <p className="text-[11px] text-ink-600 leading-snug mt-0.5">{why}</p>
        </div>
        <span className={`text-xl font-extrabold tabular-nums shrink-0 ${clear ? "text-emerald-600" : severity === "critical" ? "text-red-600" : "text-ink-900"}`}>
          {clear ? <Check className="w-5 h-5" /> : compact(count)}
        </span>
      </div>
      {!clear && (
        <div className="flex items-center gap-2 mt-2">
          <Badge tone={tone}>oldest {ago(oldest)}</Badge>
          {stale && <span className="text-[10px] text-ink-400">from the last sweep</span>}
        </div>
      )}
    </button>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────
// Same grammar as ContactProfile's slide-over, so the two feel like one product.
// A drawer rather than a page so the operator never loses their place in a list.

export function Drawer({ open, onClose, title, subtitle, actions, children, width = "w-[560px]" }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode;
  actions?: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-ink-950/20 backdrop-blur-[2px] z-40 u-fade-in" onClick={onClose} />
      <aside className={`fixed inset-y-0 right-0 ${width} max-w-full bg-canvas border-l border-line shadow-2xl z-50 flex flex-col u-slide-in-right`}>
        <header className="shrink-0 bg-white border-b border-line px-5 py-3.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-extrabold text-ink-900 truncate">{title}</h2>
            {subtitle && <div className="text-[12px] text-ink-600 mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-control hover:bg-canvas text-ink-600"><X className="w-4 h-4" /></button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
      </aside>
    </>
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
// Lifted verbatim in behaviour from the old owner page, where it was the single
// best-built component in the codebase — type-to-confirm, Escape, inline error,
// busy state — but trapped in one file.

export interface ConfirmCfg {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** When set, the confirm button unlocks only once this exact text is typed. */
  requireTyping?: string;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({ cfg, onDone }: { cfg: ConfirmCfg; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onDone(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, onDone]);
  const locked = !!cfg.requireTyping && typed.trim() !== cfg.requireTyping;
  return (
    <div className="fixed inset-0 z-[60] bg-ink-950/40 flex items-center justify-center p-4 u-fade-in" onClick={() => !busy && onDone()}>
      <div className="w-full max-w-md bg-white rounded-card border border-line p-5 space-y-3 u-scale-in" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-extrabold text-ink-900">{cfg.title}</h3>
        <div className="text-[13px] text-ink-600 leading-relaxed">{cfg.message}</div>
        {cfg.requireTyping && (
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)}
            placeholder={cfg.requireTyping}
            className="w-full border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900" />
        )}
        {err && <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onDone} disabled={busy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Cancel</button>
          <button
            onClick={async () => {
              setBusy(true); setErr(null);
              try { await cfg.onConfirm(); onDone(); }
              catch (e) { setErr(e instanceof Error ? e.message : "That didn't work."); }
              finally { setBusy(false); }
            }}
            disabled={busy || locked}
            className="px-3 py-1.5 rounded-control bg-red-600 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {cfg.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-canvas sticky top-0 z-10">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, align = "left", w }: { children?: ReactNode; align?: "left" | "right"; w?: string }) {
  return (
    <th style={w ? { width: w } : undefined}
      className={`px-3 py-2 text-[10px] font-bold text-ink-400 uppercase tracking-[0.06em] ${align === "right" ? "text-right" : "text-left"} whitespace-nowrap`}>
      {children}
    </th>
  );
}

export function Td({ children, align = "left", nums, className = "" }: { children?: ReactNode; align?: "left" | "right"; nums?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${nums ? "tabular-nums" : ""} ${className}`}>{children}</td>
  );
}

// ── Search input ──────────────────────────────────────────────────────────────

export function SearchInput({ value, onChange, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean;
}) {
  return (
    <div className="relative flex-1 min-w-[200px]">
      <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-line rounded-control pl-9 pr-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400" />
    </div>
  );
}

/** Debounce a fast-changing value so typing doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Ignore a stale response that arrives after a newer one — classic search race. */
export function useLatest() {
  const seq = useRef(0);
  return {
    next: () => ++seq.current,
    isCurrent: (n: number) => n === seq.current,
  };
}
