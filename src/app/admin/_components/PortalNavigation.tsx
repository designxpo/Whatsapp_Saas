"use client";

import type { ReactNode } from "react";
import type { Tab } from "../_shared";

export interface PortalNavGroup {
  group: string;
  items: { key: Tab; label: string; icon: ReactNode; hint: string }[];
}

/** Expanded workspace navigation, shared by the sidebar and mobile drawer. */
export function PortalNavigation({ groups, activeTab, waiting, onNavigate, onWarm }: {
  groups: PortalNavGroup[]; activeTab: Tab; waiting: number;
  onNavigate: (tab: Tab) => void; onWarm: (tab: Tab) => void;
}) {
  return <nav aria-label="Workspace navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
    <div>
      {groups.map(g => <div key={g.group} className="mb-4">
        <p className="px-3 mb-1.5 text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{g.group}</p>
        <div className="space-y-0.5">
          {g.items.map(n => <button key={n.key} type="button" data-tour-nav={n.key} data-nav-key={n.key} aria-current={activeTab === n.key ? "page" : undefined}
            data-help={n.hint} onClick={() => onNavigate(n.key)} onMouseEnter={() => onWarm(n.key)} onFocus={() => onWarm(n.key)}
            className={`nav-item relative w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-medium text-left ${activeTab === n.key ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
            {n.icon}<span className="truncate">{n.label}</span>
            {n.key === "livechat" && waiting > 0 && <span aria-label={`${waiting} waiting`} className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold leading-5 text-center tabular-nums">{waiting > 99 ? "99+" : waiting}</span>}
          </button>)}
        </div>
      </div>)}
    </div>
  </nav>;
}
