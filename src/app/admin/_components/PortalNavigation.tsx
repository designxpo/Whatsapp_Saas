"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { Tab } from "../_shared";

export interface PortalNavGroup {
  group: string;
  items: { key: Tab; label: string; icon: ReactNode; hint: string }[];
}

/** The same searchable navigation on desktop and inside the mobile drawer. */
export function PortalNavigation({ groups, activeTab, waiting, onNavigate, onWarm }: {
  groups: PortalNavGroup[]; activeTab: Tab; waiting: number;
  onNavigate: (tab: Tab) => void; onWarm: (tab: Tab) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const activeGroup = groups.find(g => g.items.some(n => n.key === activeTab))?.group;
  useEffect(() => {
    if (activeGroup) setCollapsed(c => ({ ...c, [activeGroup]: false }));
  }, [activeGroup]);
  const query = search.trim().toLowerCase();
  const visible = groups.map(g => ({ ...g, items: g.items.filter(n => !query || `${n.label} ${n.hint}`.toLowerCase().includes(query)) })).filter(g => g.items.length);

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-3 pb-3 pt-2">
      <label className="relative block">
        <span className="sr-only">Find a feature</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" aria-hidden />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a feature…" autoComplete="off"
          onKeyDown={e => { if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); } }}
          className="w-full min-w-0 rounded-lg border border-line bg-canvas/60 py-2 pl-9 pr-8 text-xs text-ink-900 placeholder:text-ink-400" />
      </label>
      {search && <button type="button" onClick={() => setSearch("")} className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[11px] text-ink-500 hover:text-ink-900"><X className="h-3 w-3" /> Clear search</button>}
    </div>
    <nav aria-label="Workspace navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
      {visible.map((g, i) => {
        const expanded = !!query || !(collapsed[g.group] ?? (g.group !== activeGroup && g.group !== groups[0]?.group));
        const panelId = `${id}-group-${i}`;
        return <div key={g.group} className="mb-2">
          <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setCollapsed(c => ({ ...c, [g.group]: expanded }))}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-400 hover:bg-canvas hover:text-ink-700">
            {g.group}<ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden />
          </button>
          <div id={panelId} hidden={!expanded} className="space-y-0.5">
            {g.items.map(n => <button key={n.key} type="button" data-tour-nav={n.key} data-nav-key={n.key} aria-current={activeTab === n.key ? "page" : undefined}
              title={n.hint} data-help={n.hint} onClick={() => onNavigate(n.key)} onMouseEnter={() => onWarm(n.key)} onFocus={() => onWarm(n.key)}
              className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-colors ${activeTab === n.key ? "bg-brand-50 font-semibold text-brand-700" : "font-medium text-ink-600 hover:bg-canvas hover:text-ink-900"}`}>
              <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{n.icon}</span><span className="min-w-0 flex-1 truncate">{n.label}</span>
              {n.key === "livechat" && waiting > 0 && <span aria-label={`${waiting} waiting`} className="rounded-full bg-red-50 px-1.5 text-[10px] font-semibold tabular-nums text-red-700">{waiting > 99 ? "99+" : waiting}</span>}
            </button>)}
          </div>
        </div>;
      })}
      {!visible.length && <p className="px-3 py-6 text-xs leading-relaxed text-ink-500">No features match “{search}”. Try another name.</p>}
    </nav>
  </div>;
}
