"use client";

// The phone's bottom tab bar (below 768px): the four places someone answering
// customers goes all day, plus More for the full menu. Each target is at least
// 48px tall and sits above the home indicator (safe-area padding).
//
// The badges are the shell's single numbers: Inbox shows "Waiting for you"
// (the same count as the Live Chat menu badge and Home), Today shows overdue.

import { Home, ListTodo, Menu, MessageSquare, Users } from "lucide-react";
import type { Tab } from "../_shared";
import { attentionLabels, badgeText } from "./shell-logic";

export function MobileTabBar({ tab, onGo, onMore, moreOpen, waiting, overdue, contactsLabel, show }: {
  tab: Tab; onGo: (t: Tab) => void; onMore: () => void; moreOpen: boolean;
  waiting: number; overdue: number; contactsLabel: string;
  /** Which of the four this person may open (plan and role). */
  show: (t: Tab) => boolean;
}) {
  const words = attentionLabels({ waiting, overdue });
  const items: { key: Tab; label: string; icon: React.ReactNode; badge: number; sr: string; help: string }[] = [
    { key: "home", label: "Home", icon: <Home className="w-5 h-5" aria-hidden />, badge: 0, sr: "", help: "What needs you today, and how things are going" },
    { key: "livechat", label: "Inbox", icon: <MessageSquare className="w-5 h-5" aria-hidden />, badge: waiting, sr: words.waiting, help: "Every conversation from every channel, in one inbox" },
    { key: "today", label: "Today", icon: <ListTodo className="w-5 h-5" aria-hidden />, badge: overdue, sr: words.overdue, help: "Everything waiting for a person — overdue first" },
    { key: "contacts", label: contactsLabel, icon: <Users className="w-5 h-5" aria-hidden />, badge: 0, sr: "", help: "Everyone who has ever messaged you" },
  ];
  return (
    <nav aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-5">
        {items.filter(i => show(i.key)).map(i => {
          const on = tab === i.key;
          return (
            <li key={i.key}>
              <button type="button" onClick={() => onGo(i.key)} aria-current={on ? "page" : undefined}
                data-tour-nav={i.key} data-tour-side="top" data-tour-title={i.label} data-help={i.help}
                className={`relative w-full min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold ${on ? "text-brand-700" : "text-ink-600"}`}>
                <span className="relative">
                  {i.icon}
                  {i.badge > 0 && (
                    <span aria-hidden className="absolute -top-1.5 left-3 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums">{badgeText(i.badge)}</span>
                  )}
                </span>
                <span className="truncate max-w-full px-1">{i.label}</span>
                {i.badge > 0 && <span className="sr-only">, {i.sr}</span>}
                {on && <span aria-hidden className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-brand-700" />}
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-controls="portal-nav"
            data-tour-nav="more" data-tour-side="top" data-tour-title="More" data-help="Everything else: your channels, broadcasts, AI, and settings"
            className="w-full min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold text-ink-600">
            <Menu className="w-5 h-5" aria-hidden />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
